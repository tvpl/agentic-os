use mordomo_shell_core::{Failure, Sidecar};
use tauri::AppHandle;

/// `mordomo-desktop --self-test`: the same payload lookup and the same supervisor as the app, without a window.
/// One JSON line on stdout; exit 0 when the bundled service started, served the Command Centre and stopped, 1 otherwise.
/// It uses the home folder the environment names (`MORDOMO_HOME`): CI points it at a temporary one.
pub fn run(app: &AppHandle) -> ! {
    let outcome = crate::shell::prepare(app).and_then(|(mut cfg, token)| {
        // A check, not a launch: it must not take or leave the port the app remembers.
        cfg.preferred_port = None;
        let mut sidecar = Sidecar::start(&cfg, &token).map_err(|e| Failure::from(&e))?;
        let ready = sidecar.ready().clone();
        let stopped = sidecar.stop();
        Ok((ready, format!("{stopped:?}")))
    });
    let (line, code) = match outcome {
        Ok((ready, stopped)) => (
            serde_json::json!({ "ok": true, "port": ready.port, "version": ready.version, "stopped": stopped }),
            0,
        ),
        Err(failure) => (serde_json::json!({ "ok": false, "error": failure.to_json() }), 1),
    };
    println!("{line}");
    std::process::exit(code);
}
