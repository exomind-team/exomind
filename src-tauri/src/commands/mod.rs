//! 命令模块导出
//! 导出所有 Tauri 命令

#[cfg(feature = "alpha-legacy-runtime")]
pub mod asr_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod dev_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod device_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod eventlog_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod file_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod keep_awake_commands;
pub mod mobile_display_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod now_workbench_overlay_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod runtime_commands;
pub mod shortcut_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod timeblock_end_alert_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod workspace_commands;
#[cfg(feature = "alpha-legacy-runtime")]
pub mod ws_commands;
