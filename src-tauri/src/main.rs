// Beta's embedded standalone debug builds are GUI applications too. Keep the
// ordinary Alpha debug console while avoiding a second window for Beta users.
#![cfg_attr(any(not(debug_assertions), exomind_beta_gui), windows_subsystem = "windows")]

fn main() {
    exomind_lib::run()
}
