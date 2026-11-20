//! One bounded Chat Completions call. Task ownership, persistent cancellation,
//! retry eligibility and evidence validation belong to the Host/Core worker.
//! A cancelled HTTP future does not promise cancellation of upstream billing.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::{Client, Url, header::HeaderValue, redirect::Policy};
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, time::Duration};
use tokio::sync::watch;

pub(crate) const MAX_MODEL_INPUT_BYTES: usize = 256 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

// Intentionally neither Debug nor Serialize: this is local private settings,
// never a status response, replicated fact, or diagnostic value.
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SummaryProviderSettings {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub max_output_tokens: u32,
    pub timeout_ms: u64,
    #[serde(default)]
    pub include_suggestions: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModelCallError {
    InvalidConfiguration,
    InputTooLarge,
    Cancelled,
    Timeout,
    Unavailable,
    ExternalOutcomeUnknown,
    RateLimited,
    Authentication,
    Rejected,
    ResponseTooLarge,
    InvalidResponse,
    IncompleteResponse,
}
impl ModelCallError {
    pub fn retryable(self) -> bool {
        matches!(self, Self::Timeout | Self::Unavailable | Self::RateLimited)
    }
}

pub(crate) struct ModelImage {
    pub media_type: String,
    pub bytes: Vec<u8>,
}

pub(crate) struct ModelInput {
    pub system: String,
    /// Frozen, explicitly scoped textual material only. Never paths or URLs to
    /// originals that a provider could fetch without a user's material choice.
    pub material: String,
    pub images: Vec<ModelImage>,
}
pub(crate) fn request_body(
    settings: &SummaryProviderSettings,
    input: &ModelInput,
) -> serde_json::Value {
    let user_content = if input.images.is_empty() {
        serde_json::Value::String(input.material.clone())
    } else {
        let mut content = Vec::with_capacity(input.images.len() + 1);
        content.push(serde_json::json!({"type":"text","text":input.material}));
        for image in &input.images {
            let data_url = format!(
                "data:{};base64,{}",
                image.media_type,
                STANDARD.encode(&image.bytes)
            );
            content.push(serde_json::json!({
                "type":"image_url",
                "image_url":{"url":data_url}
            }));
        }
        serde_json::Value::Array(content)
    };
    serde_json::json!({
        "model": settings.model,
        "stream": false,
        "max_tokens": settings.max_output_tokens,
        "messages": [
            {"role":"system","content":input.system},
            {"role":"user","content":user_content}
        ]
    })
}
#[derive(Debug)]
pub(crate) struct ModelReply {
    pub text: String,
    pub model: String,
    pub request_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

impl SummaryProviderSettings {
    pub fn endpoint(&self) -> Result<Url, ModelCallError> {
        if self.base_url.len() > 4096
            || self.model.trim().is_empty()
            || self.model.len() > 256
            || !(1..=32768).contains(&self.max_output_tokens)
            || !(1000..=120000).contains(&self.timeout_ms)
        {
            return Err(ModelCallError::InvalidConfiguration);
        }
        if let Some(key) = &self.api_key {
            if key.is_empty()
                || key.len() > 16384
                || HeaderValue::from_str(&format!("Bearer {key}")).is_err()
            {
                return Err(ModelCallError::InvalidConfiguration);
            }
        }
        let mut url =
            Url::parse(&self.base_url).map_err(|_| ModelCallError::InvalidConfiguration)?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(ModelCallError::InvalidConfiguration);
        }
        url.path_segments_mut()
            .map_err(|_| ModelCallError::InvalidConfiguration)?
            .pop_if_empty()
            .push("chat")
            .push("completions");
        Ok(url)
    }
}

fn network_error(error: reqwest::Error) -> ModelCallError {
    // Do not retain reqwest URLs, request headers, provider bodies or sources
    // in durable/user-facing errors; gateways may echo prompts and secrets.
    if error.is_timeout() {
        ModelCallError::Timeout
    } else if error.is_connect() {
        ModelCallError::Unavailable
    } else {
        ModelCallError::ExternalOutcomeUnknown
    }
}

#[derive(Deserialize)]
struct Completion {
    id: Option<String>,
    model: String,
    choices: Vec<Choice>,
    usage: Option<Usage>,
}
#[derive(Deserialize)]
struct Choice {
    message: Message,
    finish_reason: Option<String>,
}
#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}
#[derive(Deserialize)]
struct Usage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

async fn await_cancel(cancel: &mut watch::Receiver<bool>) {
    loop {
        if *cancel.borrow_and_update() {
            return;
        }
        if cancel.changed().await.is_err() {
            return;
        }
    }
}

pub(crate) async fn complete(
    settings: &SummaryProviderSettings,
    input: &ModelInput,
    mut cancel: watch::Receiver<bool>,
) -> Result<ModelReply, ModelCallError> {
    let endpoint = settings.endpoint()?;
    let body = request_body(settings, input);
    let encoded_body =
        serde_json::to_vec(&body).map_err(|_| ModelCallError::InvalidConfiguration)?;
    // Keep the established v4 text-only bound exactly. The media path accounts
    // for the complete multimodal JSON envelope, including base64 expansion.
    let measured = if input.images.is_empty() {
        input.system.len().saturating_add(input.material.len())
    } else {
        encoded_body.len()
    };
    if measured > MAX_MODEL_INPUT_BYTES {
        return Err(ModelCallError::InputTooLarge);
    }
    // Proxy configuration must not make a local Magpie/Ollama gateway depend
    // on an unrelated remote proxy being available.
    let local = endpoint.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
    });
    let mut builder = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_millis(settings.timeout_ms.min(10000)))
        .timeout(Duration::from_millis(settings.timeout_ms));
    if local {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| ModelCallError::InvalidConfiguration)?;
    let operation = async {
        let mut request = client.post(endpoint).json(&body);
        if let Some(key) = &settings.api_key {
            request = request.bearer_auth(key);
        }
        let mut response = request.send().await.map_err(network_error)?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(match status {
                401 | 403 => ModelCallError::Authentication,
                408 | 504 => ModelCallError::Timeout,
                429 => ModelCallError::RateLimited,
                500..=599 => ModelCallError::Unavailable,
                _ => ModelCallError::Rejected,
            });
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(ModelCallError::ResponseTooLarge);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(network_error)? {
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(ModelCallError::ResponseTooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        #[cfg(test)]
        if let Ok(directory) = std::env::var("EXOMIND_LIVE_MODEL_ARTIFACT_DIR") {
            let directory = std::path::PathBuf::from(directory);
            // Explicit synthetic live QA only; never enabled in a product
            // binary or ordinary tests, never capture headers/credentials.
            if directory.is_absolute() && directory.join("synthetic-live-model.marker").is_file() {
                use std::io::Write;
                let target =
                    directory.join(format!("provider-reply-{}.json", uuid::Uuid::new_v4()));
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(target)
                {
                    let _ = file.write_all(&body);
                }
            }
        }
        let value: Completion =
            serde_json::from_slice(&body).map_err(|_| ModelCallError::InvalidResponse)?;
        if value.choices.len() != 1
            || value.model.is_empty()
            || value.model.len() > 256
            || value.id.as_ref().is_some_and(|id| id.len() > 256)
        {
            return Err(ModelCallError::InvalidResponse);
        }
        let choice = value
            .choices
            .into_iter()
            .next()
            .ok_or(ModelCallError::InvalidResponse)?;
        if choice.finish_reason.as_deref() != Some("stop") {
            return Err(ModelCallError::IncompleteResponse);
        }
        let text = choice
            .message
            .content
            .filter(|text| !text.trim().is_empty())
            .ok_or(ModelCallError::InvalidResponse)?;
        Ok(ModelReply {
            text,
            model: value.model,
            request_id: value.id,
            input_tokens: value.usage.as_ref().and_then(|usage| usage.prompt_tokens),
            output_tokens: value
                .usage
                .as_ref()
                .and_then(|usage| usage.completion_tokens),
        })
    };
    tokio::select! {
        biased;
        _ = await_cancel(&mut cancel) => Err(ModelCallError::Cancelled),
        result = operation => result,
    }
}

#[cfg(test)]
#[path = "model_provider_tests.rs"]
mod tests;
