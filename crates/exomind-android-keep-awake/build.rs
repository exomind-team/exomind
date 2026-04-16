const COMMANDS: &[&str] = &["set_enabled"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
