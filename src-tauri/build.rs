#[path = "build_support/beta_windows_version.rs"]
mod beta_windows_version;

fn main() -> Result<(), String> {
    println!("cargo:rustc-check-cfg=cfg(exomind_beta_gui)");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "android" {
        // A shared library can otherwise link successfully with unresolved Rust
        // internals and fail only when Android's loader starts the Activity.
        println!("cargo:rustc-link-arg-cdylib=-Wl,--no-undefined");
    }
    let overlay = std::env::var_os("TAURI_CONFIG");
    let version = beta_windows_version::select_resource_version(
        &target_os,
        overlay.as_deref(),
        include_str!("tauri.beta.conf.json"),
    )?;
    let Some(version) = version else {
        tauri_build::build();
        return Ok(());
    };
    // The selector above only returns Some for the exact Windows Beta overlay.
    // This affects the executable subsystem, not logging or runtime storage.
    println!("cargo:rustc-cfg=exomind_beta_gui");

    // tauri-build 2.5.6 sets numeric versions from config, but tauri-winres
    // 0.3.5 still initializes the two version strings from this process env.
    // Do not emit rustc-env: the shared Alpha package version must stay intact.
    let original_version = std::env::var_os("CARGO_PKG_VERSION");
    // SAFETY: This build script has not started any threads. The synchronous
    // tauri_build call below is the only consumer during this temporary scope.
    #[allow(unused_unsafe)] // Environment mutation is unsafe in Rust 2024.
    unsafe {
        std::env::set_var("CARGO_PKG_VERSION", &version);
    }
    let result = tauri_build::try_build(tauri_build::Attributes::new());
    // SAFETY: try_build has returned synchronously, with no background work
    // started by this script. Restore even on Err before reporting the result.
    #[allow(unused_unsafe)]
    unsafe {
        match original_version {
            Some(original) => std::env::set_var("CARGO_PKG_VERSION", original),
            None => std::env::remove_var("CARGO_PKG_VERSION"),
        }
    }
    result.map_err(|error| format!("Beta Windows resource build failed: {error:#}"))
}
