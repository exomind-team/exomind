use reqwest::StatusCode;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CliError {
    #[error("io error (IO 错误): {0}")]
    Io(#[from] std::io::Error),

    #[error("request failed (请求失败): {0}")]
    Transport(#[from] reqwest::Error),

    #[error("rt returned HTTP {status}: {body_preview}")]
    HttpResponse {
        status: StatusCode,
        body_preview: String,
    },

    #[error("invalid json response (JSON 响应解析失败): {source}; body={body_preview}")]
    JsonResponse {
        #[source]
        source: serde_json::Error,
        body_preview: String,
    },

    #[error("{0}")]
    Message(String),
}
