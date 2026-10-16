//! The signed updater. It exists only in a build made with the updater's public key (`--features updater`, which
//! `scripts/` and the release workflow pass when `tauri.updater.conf.json` carries a real key); any other build has
//! neither the plugin nor the menu item, and says so in "About".
//!
//! It contacts one endpoint (`plugins.updater.endpoints` of `tauri.updater.conf.json`, declared in
//! `legal/network-policy.json`), only when the owner has `updates.check` on or asks for it from the menu, and accepts
//! a download only if its minisign signature verifies against the configured public key.
//!
//! The manifest names assets on `github.com`; GitHub answers a release download with a redirect to
//! `https://release-assets.githubusercontent.com/` (older releases: `https://objects.githubusercontent.com/`), which the
//! HTTP client follows. Those three hosts are the whole list in `legal/network-policy.json`.

use tauri::AppHandle;

#[cfg(not(feature = "updater"))]
pub fn check_in_background(_app: &AppHandle) {}

#[cfg(feature = "updater")]
pub fn check_in_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(&app, false).await {
            eprintln!("[mordomo-desktop] update check failed: {error}");
        }
    });
}

#[cfg(feature = "updater")]
pub fn check_interactive(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(&app, true).await {
            tauri_plugin_dialog::DialogExt::dialog(&app)
                .message(format!(
                    "The update could not be checked or installed.\n\n{error}"
                ))
                .title("MordomoOS")
                .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                .show(|_| {});
        }
    });
}

#[cfg(feature = "updater")]
async fn run(app: &AppHandle, interactive: bool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tauri::Manager;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;

    let Some(update) = app.updater()?.check().await? else {
        if interactive {
            app.dialog()
                .message(format!(
                    "MordomoOS {} is the latest version.",
                    env!("CARGO_PKG_VERSION")
                ))
                .title("MordomoOS")
                .kind(MessageDialogKind::Info)
                .show(|_| {});
        }
        return Ok(());
    };
    // The signature protects the bytes; this keeps the request itself on GitHub, whatever a manifest says.
    if update.download_url.scheme() != "https" || update.download_url.host_str() != Some("github.com") {
        return Err(format!("the update points outside github.com ({})", update.download_url).into());
    }
    let wanted = {
        let (tx, rx) = tauri::async_runtime::channel::<bool>(1);
        app.dialog()
            .message(format!(
                "MordomoOS {} is available (you have {}).\n\nInstall it now? The app restarts; running agents are asked to finish first.",
                update.version, update.current_version
            ))
            .title("Update available")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom("Install and restart".into(), "Later".into()))
            .show(move |yes| {
                let _ = tx.try_send(yes);
            });
        let mut rx = rx;
        rx.recv().await.unwrap_or(false)
    };
    if !wanted {
        return Ok(());
    }
    // The plugin checks the minisign signature of what it downloaded against the public key in the configuration;
    // `download` fails, and nothing is installed, when it does not verify.
    let bytes = update.download(|_chunk, _total| {}, || {}).await?;
    // Stop the service before the installer replaces the files it runs from (on Windows they would be locked); when the
    // install fails the files are the old ones, so the service is started again and the window goes back to it.
    mordomo_shell_core::policy::install_with_service_stopped(
        || app.state::<crate::shell::Shell>().stop_sidecar(),
        || update.install(&bytes),
        || crate::shell::spawn_start(app.clone()),
    )?;
    app.restart();
}
