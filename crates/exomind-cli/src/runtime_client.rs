use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::CliError;

#[derive(Debug, Clone)]
pub struct RuntimeClient {
    target: String,
    base_url: String,
    auth_token: Option<String>,
    http: reqwest::Client,
}

impl RuntimeClient {
    pub fn new(
        target: impl Into<String>,
        base_url: impl Into<String>,
        auth_token: Option<String>,
    ) -> Result<Self, CliError> {
        Ok(Self {
            target: target.into(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            auth_token,
            http: reqwest::Client::builder().build()?,
        })
    }

    pub fn from_target(
        target: impl Into<String>,
        auth_token: Option<String>,
    ) -> Result<Self, CliError> {
        let target = target.into();
        let base_url = format!("http://{target}");
        Self::new(target, base_url, auth_token)
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub async fn health(&self) -> Result<serde_json::Value, CliError> {
        self.get_json("/health").await
    }

    pub async fn get_json<T>(&self, path: &str) -> Result<T, CliError>
    where
        T: DeserializeOwned,
    {
        self.send_json(self.request(reqwest::Method::GET, path)?).await
    }

    pub async fn post_json<T, B>(&self, path: &str, body: &B) -> Result<T, CliError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.send_json(self.request(reqwest::Method::POST, path)?.json(body))
            .await
    }

    pub async fn put_json<T, B>(&self, path: &str, body: &B) -> Result<T, CliError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.send_json(self.request(reqwest::Method::PUT, path)?.json(body))
            .await
    }

    pub async fn patch_json<T, B>(&self, path: &str, body: &B) -> Result<T, CliError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.send_json(self.request(reqwest::Method::PATCH, path)?.json(body))
            .await
    }

    pub async fn delete_json<T>(&self, path: &str) -> Result<T, CliError>
    where
        T: DeserializeOwned,
    {
        self.send_json(self.request(reqwest::Method::DELETE, path)?)
            .await
    }

    pub fn with_scope(&self, path: &str, scope_pairs: &[(String, String)]) -> String {
        if scope_pairs.is_empty() {
            return path.to_string();
        }

        let separator = if path.contains('?') { '&' } else { '?' };
        let query = scope_pairs
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("&");
        format!("{path}{separator}{query}")
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<reqwest::RequestBuilder, CliError> {
        let url = format!("{}{}", self.base_url, normalize_path(path));
        let mut builder = self.http.request(method, url);

        if let Some(token) = &self.auth_token {
            builder = builder.bearer_auth(token);
        }

        Ok(builder)
    }

    async fn send_json<T>(&self, builder: reqwest::RequestBuilder) -> Result<T, CliError>
    where
        T: DeserializeOwned,
    {
        let response = builder.send().await?;
        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(CliError::HttpResponse {
                status,
                body_preview: preview(&body),
            });
        }

        serde_json::from_str(&body).map_err(|source| CliError::JsonResponse {
            source,
            body_preview: preview(&body),
        })
    }
}

fn normalize_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

fn preview(body: &str) -> String {
    const MAX_LEN: usize = 200;
    let compact = body.replace('\n', " ").replace('\r', " ");
    compact.chars().take(MAX_LEN).collect()
}
