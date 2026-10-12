mod common;

use common::{alive, config, free_port, gone_within, pid_in};
use mordomo_shell_core::{Failure, FailureKind, LaunchToken, Sidecar, StartError, StopOutcome};
use std::time::{Duration, Instant};

fn token() -> LaunchToken {
    LaunchToken::generate().unwrap()
}

fn start_err(mode: &str) -> StartError {
    match Sidecar::start(&config(mode), &token()) {
        Ok(_) => panic!("{mode}: expected the start to fail"),
        Err(e) => e,
    }
}

#[test]
fn a_service_that_listens_is_started_once_the_page_answers_and_the_secret_is_in_its_environment_only() {
    let secret = token();
    let mut sidecar = Sidecar::start(&config("ok"), &secret).unwrap();
    let tail = sidecar.stdout_tail();
    assert_eq!(sidecar.ready().version, "9.9.9");
    assert_eq!(sidecar.origin(), format!("http://127.0.0.1:{}", sidecar.port()));
    assert_eq!(
        sidecar.launch_url(),
        format!("http://127.0.0.1:{}/?launch={}", sidecar.port(), secret.expose())
    );
    // argv: the command and the port the shell asked for (0: the system's choice); the secret is not in it.
    let argv = tail.iter().find(|l| l.starts_with("ARGV ")).unwrap();
    assert_eq!(argv, r#"ARGV ["start","--foreground","--sidecar","--port","0"]"#);
    assert!(!tail.iter().any(|l| l.contains(secret.expose())));
    // the environment: it arrived whole.
    assert!(tail.contains(&"SECRET_LEN 43".to_string()), "{tail:?}");
    assert!(sidecar.is_running());
    sidecar.stop();
}

#[test]
fn the_preferred_port_is_what_the_service_is_asked_for() {
    let port = free_port();
    let mut cfg = config("ok");
    cfg.preferred_port = Some(port);
    let mut sidecar = Sidecar::start(&cfg, &token()).unwrap();
    assert!(sidecar.stdout_tail().contains(&format!(
        r#"ARGV ["start","--foreground","--sidecar","--port","{port}"]"#
    )));
    assert_eq!(sidecar.port(), port);
    sidecar.stop();
}

#[test]
fn a_busy_preferred_port_starts_again_once_with_the_systems_choice() {
    let busy = free_port();
    let mut cfg = config("busy-if-port");
    cfg.preferred_port = Some(busy);
    let mut sidecar = Sidecar::start(&cfg, &token()).unwrap();
    assert_ne!(sidecar.port(), busy);
    assert!(sidecar
        .stdout_tail()
        .contains(&r#"ARGV ["start","--foreground","--sidecar","--port","0"]"#.to_string()));
    sidecar.stop();
}

#[test]
fn a_busy_port_with_no_fallback_left_is_port_busy() {
    // Nothing preferred: the first attempt already asks the system, so exit 5 is final.
    let error = start_err("exit5");
    assert!(matches!(&error, StartError::ExitedEarly { code: Some(5), .. }));
    assert_eq!(Failure::from(&error).kind, FailureKind::PortBusy);
}

#[test]
fn an_early_exit_carries_its_code_its_stderr_and_a_kind() {
    for (mode, kind) in [
        ("exit4", FailureKind::HomeInUse),
        ("exit3", FailureKind::HomeBlocked),
        ("exit2", FailureKind::Crashed),
        ("exit1", FailureKind::Crashed),
    ] {
        let error = start_err(mode);
        let failure = Failure::from(&error);
        assert_eq!(failure.kind, kind, "{mode}");
        assert!(
            failure.detail.starts_with("exit code "),
            "{mode}: {}",
            failure.detail
        );
        let code = mode.trim_start_matches("exit");
        assert_eq!(
            failure.tail,
            vec![format!("the service says it is ending with {code}")],
            "{mode}"
        );
    }
}

#[test]
fn a_service_that_never_says_ready_is_killed_after_the_startup_time() {
    let mut cfg = config("silent");
    cfg.startup_timeout = Duration::from_secs(2);
    let started = Instant::now();
    let error = Sidecar::start(&cfg, &token()).expect_err("must time out");
    assert!(started.elapsed() >= Duration::from_secs(2) && started.elapsed() < Duration::from_secs(10));
    let StartError::Timeout { stdout, .. } = &error else {
        panic!("{error:?}")
    };
    assert_eq!(Failure::from(&error).kind, FailureKind::Timeout);
    assert!(
        gone_within(pid_in(stdout), 3000),
        "the silent service is still running"
    );
}

#[test]
fn a_line_that_is_not_a_ready_line_is_refused_and_the_service_killed() {
    let error = start_err("badready");
    assert!(matches!(&error, StartError::BadReady { .. }), "{error:?}");
    let failure = Failure::from(&error);
    assert_eq!(failure.kind, FailureKind::BadReady);
    assert!(failure.detail.contains("MORDOMO_READY {nope"));
}

#[test]
fn a_service_that_listens_but_serves_no_page_is_killed() {
    let error = start_err("json");
    assert!(matches!(&error, StartError::Ui { .. }), "{error:?}");
    assert_eq!(Failure::from(&error).kind, FailureKind::UiNotServed);
}

#[test]
fn stop_closes_stdin_and_the_service_ends_by_itself_and_stop_is_idempotent() {
    let mut sidecar = Sidecar::start(&config("ok"), &token()).unwrap();
    let pid = pid_in(&sidecar.stdout_tail());
    let started = Instant::now();
    assert_eq!(sidecar.stop(), StopOutcome::Exited(Some(0)));
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "a service that obeys stdin is not made to wait out the grace"
    );
    assert!(!alive(pid));
    assert!(!sidecar.is_running());
    assert_eq!(sidecar.stop(), StopOutcome::Exited(Some(0)));
}

#[test]
fn a_service_that_ignores_stdin_is_killed_only_after_the_grace_period() {
    let mut cfg = config("stubborn");
    cfg.shutdown_grace = Duration::from_millis(800);
    let mut sidecar = Sidecar::start(&cfg, &token()).unwrap();
    let pid = pid_in(&sidecar.stdout_tail());
    let started = Instant::now();
    assert_eq!(sidecar.stop(), StopOutcome::Killed);
    assert!(
        started.elapsed() >= Duration::from_millis(800),
        "killed before the grace was over"
    );
    assert!(gone_within(pid, 3000));
    assert_eq!(sidecar.stop(), StopOutcome::Killed);
}

#[test]
fn dropping_a_running_sidecar_stops_it() {
    let sidecar = Sidecar::start(&config("ok"), &token()).unwrap();
    let pid = pid_in(&sidecar.stdout_tail());
    assert!(alive(pid));
    drop(sidecar);
    assert!(
        gone_within(pid, 4000),
        "dropping the sidecar left the service running"
    );
}

#[test]
fn a_service_that_ends_on_its_own_is_seen_as_not_running_with_its_code() {
    let mut sidecar = Sidecar::start(&config("dies"), &token()).unwrap();
    let until = Instant::now() + Duration::from_secs(5);
    while sidecar.is_running() && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!sidecar.is_running());
    assert_eq!(sidecar.exit_code(), Some(7));
}

#[test]
fn a_payload_missing_its_files_is_payload_missing_and_nothing_is_started() {
    let mut cfg = config("ok");
    cfg.payload.entry = cfg.payload.root.join("no-such-entry.mjs");
    let error = Sidecar::start(&cfg, &token()).err().unwrap();
    let failure = Failure::from(&error);
    assert_eq!(failure.kind, FailureKind::PayloadMissing);
    assert!(failure.detail.ends_with("no-such-entry.mjs"));
    // And it does not look for a Node on PATH instead.
    let mut cfg = config("ok");
    cfg.payload.node = cfg.payload.root.join("runtime").join("no-node");
    assert_eq!(
        Failure::from(&Sidecar::start(&cfg, &token()).err().unwrap()).kind,
        FailureKind::PayloadMissing
    );
}

#[cfg(unix)]
#[test]
fn a_node_that_the_system_will_not_run_is_spawn_failed() {
    use std::os::unix::fs::PermissionsExt;
    let mut cfg = config("ok");
    let not_executable = std::env::temp_dir().join(format!("mordomo-not-node-{}", std::process::id()));
    std::fs::write(&not_executable, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&not_executable, std::fs::Permissions::from_mode(0o644)).unwrap();
    cfg.payload.node = not_executable.clone();
    let error = Sidecar::start(&cfg, &token()).err().unwrap();
    std::fs::remove_file(not_executable).unwrap();
    assert_eq!(Failure::from(&error).kind, FailureKind::SpawnFailed);
}
