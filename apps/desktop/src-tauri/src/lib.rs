//! MordomoOS desktop: a Tauri 2 window around the bundled local service.
//!
//! The logic that needs no webview (the launch secret, the supervisor, the address policy) is `mordomo-shell-core`
//! and is tested without a display. This crate puts a window, a menu, a single-instance lock and the updater around it.

mod menu;
mod selftest;
mod shell;
mod updater;

use tauri::{Manager, RunEvent};

/// `--self-test`: start the bundled service the way the app does, check it serves the Command Centre, stop it, print
/// one JSON line and exit, with no window (docs/release.md, "What CI proves").
const SELF_TEST_FLAG: &str = "--self-test";

pub fn run() {
    let self_test = std::env::args().any(|a| a == SELF_TEST_FLAG);
    let mut builder = tauri::Builder::default();
    if !self_test {
        // First, as the plugin requires: a second launch tells this one to come forward and exits.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            shell::focus_main(app)
        }));
    }
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(feature = "updater")]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    let app = builder
        .manage(shell::Shell::default())
        .invoke_handler(tauri::generate_handler![
            shell::shell_status,
            shell::shell_retry,
            shell::shell_quit
        ])
        .setup(move |app| {
            if self_test {
                selftest::run(app.handle());
            }
            menu::install(app)?;
            shell::open_main_window(app.handle())?;
            shell::spawn_start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the MordomoOS app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // The service is stopped through its stdin before the app is gone; if the app dies first, the pipe
            // closes and the service stops itself.
            handle.state::<shell::Shell>().stop_sidecar();
        }
    });
}
