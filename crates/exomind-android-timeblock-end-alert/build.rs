const COMMANDS: &[&str] = &[
    "schedule_end_alert",
    "cancel_end_alert",
    "take_pending_handoff",
    "notification_permission_state",
    "notification_permission_request",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
