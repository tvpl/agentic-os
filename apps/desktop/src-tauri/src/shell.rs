//! The shell's state (starting, ready, failed), the window, and the three commands its own screen may call.

pub use mordomo_shell_core::shell::{Shell, ShellWindow};
use mordomo_shell_core::shell::{Status, Watch};
use mordomo_shell_core::state::DesktopState;
use mordomo_shell_core::{
    on_navigation, on_new_window, Config, Failure, LaunchToken, Payload, Sidecar, StartError,
};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW: &str = "main";

/// The window of the app (or none: it is not there yet, or it is gone) as the shell's decisions see it. The decisions are
/// `mordomo_shell_core::shell::Shell`, tested there against a stand-in window; this is the whole of the glue.
struct MainWindow(Option<WebviewWindow>);

impl MainWindow {
    fn of(app: &AppHandle) -> Self {
        Self(app.get_webview_window(MAIN_WINDOW))
    }
}

impl ShellWindow for MainWindow {
    fn address(&self) -> Option<String> {
        self.0.as_ref()?.url().ok().map(String::from)
    }

    fn go_to(&self, address: &str) {
        if let (Some(window), Ok(url)) = (&self.0, Url::parse(address)) {
            let _ = window.navigate(url);
        }
    }
}

pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The window opens on the shell's own screen; the service's page replaces it when the service is ready.
pub fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    let for_navigation = app.clone();
    let for_new_window = app.clone();
    let window = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
        .title("MordomoOS")
        .inner_size(1280.0, 860.0)
        .min_inner_size(800.0, 560.0)
        .on_navigation(move |url| gate(&for_navigation, url))
        // A click on `<a target="_blank">` never reaches `on_new_window` in WebKitGTK (observed); the script turns the click
        // into `window.open(address, "_blank")`, which does. It runs before the page's own scripts and has no access to the shell.
        .initialization_script(include_str!("new-window.js"))
        // No second webview is ever created. A link that wants a new window goes where the policy says.
        .on_new_window(move |url, _features| {
            // The service's own origin in a new window (an artifact or a file) is shown by the system browser, not
            // by a webview this shell would have to police.
            let handling = on_new_window(url.as_str(), for_new_window.state::<Shell>().sidecar_port());
            if handling.open_in_system {
                open_externally(&for_new_window, &url);
            }
            NewWindowResponse::Deny
        })
        .build()?;
    app.state::<Shell>()
        .remember_local_screen(window.url().ok().map(String::from));
    Ok(())
}

/// The navigation handler of the window: its answer is whether the webview loads `url`. The decision is
/// `mordomo_shell_core::on_navigation`, tested there; `smoke/gui.sh` (scenario F) proves the window obeys it.
fn gate(app: &AppHandle, url: &Url) -> bool {
    let handling = on_navigation(url.as_str(), app.state::<Shell>().sidecar_port());
    if handling.open_in_system {
        open_externally(app, url);
    }
    handling.load_in_window
}

fn open_externally(app: &AppHandle, url: &Url) {
    // Only what the policy classed as a web or mail address (or the service's own origin) reaches here.
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn locate_payload(app: &AppHandle) -> Result<Payload, StartError> {
    // A debug build (cargo run) has no installer around it: point it at a payload folder by hand.
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("MORDOMO_DESKTOP_PAYLOAD") {
        return Ok(Payload::at(&PathBuf::from(dir))?);
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| StartError::Spawn(format!("the resource folder is unknown: {e}")))?;
    Ok(Payload::at(&resources.join("payload"))?)
}

fn state_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("desktop-state.json"))
}

/// Everything `Sidecar::start` needs, or the failure that says why not.
pub fn prepare(app: &AppHandle) -> Result<(Config, LaunchToken), Failure> {
    let payload = locate_payload(app).map_err(|e| Failure::from(&e))?;
    let token = LaunchToken::generate().map_err(|e| Failure {
        kind: mordomo_shell_core::FailureKind::SpawnFailed,
        detail: format!("the system could not make a random secret: {e}"),
        tail: vec![],
    })?;
    let mut cfg = Config::new(payload);
    cfg.preferred_port = state_file(app).and_then(|file| DesktopState::load(&file).port);
    Ok((cfg, token))
}

pub fn spawn_start(app: AppHandle) {
    thread::spawn(move || start(&app));
}

fn start(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let generation = shell.begin_start();
    let started = prepare(app).and_then(|(cfg, token)| {
        Sidecar::start(&cfg, &token)
            .map_err(|e| Failure::from(&e))
            .map(|sidecar| (sidecar, cfg))
    });
    match started {
        Err(failure) => shell.start_failed(generation, failure, &MainWindow::of(app)),
        Ok((sidecar, _cfg)) => {
            let ready = sidecar.ready().clone();
            if !shell.start_ready(generation, sidecar, &MainWindow::of(app)) {
                return; // stopped while it started (the app is closing); the service was dropped, which stops it
            }
            // Remember the port, so the Command Centre keeps one origin (and its localStorage) across launches.
            if let Some(file) = state_file(app) {
                let _ = DesktopState {
                    port: Some(ready.port),
                }
                .save(&file);
            }
            monitor(app.clone(), generation);
            if mordomo_shell_core::policy::check_for_update_at_start(cfg!(feature = "updater"), &ready) {
                crate::updater::check_in_background(app);
            }
        }
    }
}

/// Watch the service; when it ends without being stopped, the failure goes on the shell's own screen.
fn monitor(app: AppHandle, generation: u64) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let shell = app.state::<Shell>();
        if shell.watch(generation, &MainWindow::of(&app)) == Watch::Done {
            return;
        }
    });
}

// ---- the three commands the shell's own screen may call (capabilities/main.json) ----------------------------

#[tauri::command]
pub fn shell_status(shell: tauri::State<'_, Shell>) -> serde_json::Value {
    let (state, failure) = match &shell.status() {
        Status::Starting => ("starting", serde_json::Value::Null),
        Status::Ready => ("ready", serde_json::Value::Null),
        Status::Failed(failure) => ("failed", failure.to_json()),
    };
    serde_json::json!({ "state": state, "failure": failure, "version": env!("CARGO_PKG_VERSION") })
}

#[tauri::command]
pub fn shell_retry(app: AppHandle, shell: tauri::State<'_, Shell>) {
    if shell.is_failed() {
        spawn_start(app);
    }
}

#[tauri::command]
pub fn shell_quit(app: AppHandle) {
    app.exit(0);
}
