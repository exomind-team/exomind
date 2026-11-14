fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // A shared library can otherwise link successfully with unresolved Rust
        // internals and fail only when Android's loader starts the Activity.
        println!("cargo:rustc-link-arg-cdylib=-Wl,--no-undefined");
    }
    tauri_build::build()
}
