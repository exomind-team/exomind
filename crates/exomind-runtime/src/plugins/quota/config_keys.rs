/// Config store key constants for QuotaMonitor plugin.
pub mod config_keys {
    /// MiniMax API key (scope: user, sensitive: true).
    pub const MINIMAX_API_KEY: &str = "exomind:minimaxApiKey";
    /// Warning threshold for interval_remains (default: 1000).
    pub const QUOTA_WARNING_THRESHOLD: &str = "exomind:quotaWarningThreshold";
    /// Whether quota polling is enabled (default: true).
    pub const QUOTA_POLLING_ENABLED: &str = "exomind:quotaPollingEnabled";
    /// Heartbeat interval in minutes (default: 5).
    pub const QUOTA_HEARTBEAT_INTERVAL_MINUTES: &str = "exomind:quotaHeartbeatIntervalMinutes";
}
