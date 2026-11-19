// Run the platform-independent Native journal regressions in the existing
// Host CI lane. This adds no production dependency on Tauri or a GUI SDK.
#[path = "../../../src-tauri/src/beta_export_journal.rs"]
mod beta_export_journal;
