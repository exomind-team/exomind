fn main() {
    tauri_plugin::Builder::new(&["read_image"])
        .android_path("android")
        .build();
}
