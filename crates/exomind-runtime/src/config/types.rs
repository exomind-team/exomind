use serde::{Deserialize, Serialize};

pub const USER_CONFIG_SCOPE: &str = "user";
pub const DEVICE_CONFIG_SCOPE: &str = "device";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    pub scope: String,
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub sensitive: bool,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_origin: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutConfigEntryInput {
    pub scope: String,
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub sensitive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_origin: Option<String>,
}
