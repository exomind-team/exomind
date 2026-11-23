const COMMANDS: &[&str] = &["cancel_receiving", "is_receiving"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
