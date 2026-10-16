//! The shell's state (starting, ready, failed), the window, and the three commands its own screen may call.

use mordomo_shell_core::state::DesktopState;
use mordomo_shell_core::{
    on_navigation, on_new_window, Config, Failure, LaunchToken, Payload, Sidecar, StartError,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW: &str = "main";

#[derive(Debug, Clone)]
enum Status {
    Starting,
    Ready,
    Failed(Failure),
}

struct Inner {
    status: Status,
    sidecar: Option<Sidecar>,
    /// Bumped by every start, so a monitor of an earlier service never reports on a later one.
    generation: u64,
    /// The address of the shell's own screen, to go back to when the service ends.
    local_screen: Option<Url>,
}

pub struct Shell {
    inner: Mutex<Inner>,
    /// The port the service said it listens on (0: none yet). The address policy reads it on the UI thread.
    port: AtomicU16,
}

impl Default for Shell {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: Status::Starting,
                sidecar: None,
                generation: 0,
                local_screen: None,
            }),
            port: AtomicU16::new(0),
        }
    }
}

impl Shell {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn sidecar_port(&self) -> Option<u16> {
        Some(self.port.load(Ordering::Relaxed)).filter(|p| *p != 0)
    }

    /// Stop the service (through its stdin; the kill comes only after the grace period). Safe to call twice.
    pub fn stop_sidecar(&self) {
        let sidecar = {
            let mut inner = self.lock();
            inner.generation += 1;
            self.port.store(0, Ordering::Relaxed);
            inner.sidecar.take()
        };
        if let Some(mut sidecar) = sidecar {
            sidecar.stop();
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
    app.state::<Shell>().lock().local_screen = window.url().ok();
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
    shell.stop_sidecar();
    let generation = {
        let mut inner = shell.lock();
        inner.status = Status::Starting;
        inner.generation
    };
    let started = prepare(app).and_then(|(cfg, token)| {
        Sidecar::start(&cfg, &token)
            .map_err(|e| Failure::from(&e))
            .map(|sidecar| (sidecar, cfg))
    });
    match started {
        Err(failure) => {
            let mut inner = shell.lock();
            if inner.generation == generation {
                inner.status = Status::Failed(failure);
                let local = inner.local_screen.clone();
                drop(inner);
                // A start that follows a service that was stopped (an update whose install failed, then a restart that
                // failed too) finds the window on the old Command Centre: show the failure on the shell's own screen.
                show_failure_on_shell_screen(app, local);
            }
        }
        Ok((sidecar, _cfg)) => {
            let launch = sidecar.launch_url();
            let ready = sidecar.ready().clone();
            let mut inner = shell.lock();
            if inner.generation != generation {
                return; // stopped while it started (the app is closing); dropping the sidecar stops it
            }
            // Remember the port, so the Command Centre keeps one origin (and its localStorage) across launches.
            if let Some(file) = state_file(app) {
                let _ = DesktopState {
                    port: Some(ready.port),
                }
                .save(&file);
            }
            shell.port.store(ready.port, Ordering::Relaxed);
            inner.sidecar = Some(sidecar);
            inner.status = Status::Ready;
            drop(inner);
            if let (Some(window), Ok(url)) = (app.get_webview_window(MAIN_WINDOW), Url::parse(&launch)) {
                let _ = window.navigate(url);
            }
            monitor(app.clone(), generation);
            if mordomo_shell_core::policy::check_for_update_at_start(cfg!(feature = "updater"), &ready) {
                crate::updater::check_in_background(app);
            }
        }
    }
}

/// Put the window on the shell's own screen, where the failure is shown, unless it is there already.
fn show_failure_on_shell_screen(app: &AppHandle, local: Option<Url>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let current = window.url().ok();
    if mordomo_shell_core::policy::failure_needs_the_shell_screen(
        current.as_ref().map(Url::as_str),
        local.as_ref().map(Url::as_str),
    ) {
        if let Some(local) = local {
            let _ = window.navigate(local);
        }
    }
}

/// Watch the service; when it ends without being stopped, put the failure on the shell's own screen.
fn monitor(app: AppHandle, generation: u64) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let shell = app.state::<Shell>();
        let mut inner = shell.lock();
        if inner.generation != generation {
            return;
        }
        let Some(sidecar) = inner.sidecar.as_mut() else {
            return;
        };
        if sidecar.is_running() {
            continue;
        }
        let failure = Failure::stopped(sidecar.exit_code(), sidecar.stderr_tail());
        inner.sidecar = None;
        inner.status = Status::Failed(failure);
        shell.port.store(0, Ordering::Relaxed);
        let local = inner.local_screen.clone();
        drop(inner);
        if let (Some(window), Some(local)) = (app.get_webview_window(MAIN_WINDOW), local) {
            let _ = window.navigate(local);
        }
        return;
    });
}

// ---- the three commands the shell's own screen may call (capabilities/main.json) ----------------------------

#[tauri::command]
pub fn shell_status(shell: tauri::State<'_, Shell>) -> serde_json::Value {
    let (state, failure) = match &shell.lock().status {
        Status::Starting => ("starting", serde_json::Value::Null),
        Status::Ready => ("ready", serde_json::Value::Null),
        Status::Failed(failure) => ("failed", failure.to_json()),
    };
    serde_json::json!({ "state": state, "failure": failure, "version": env!("CARGO_PKG_VERSION") })
}

#[tauri::command]
pub fn shell_retry(app: AppHandle, shell: tauri::State<'_, Shell>) {
    if matches!(shell.lock().status, Status::Failed(_)) {
        spawn_start(app);
    }
}

#[tauri::command]
pub fn shell_quit(app: AppHandle) {
    app.exit(0);
}
