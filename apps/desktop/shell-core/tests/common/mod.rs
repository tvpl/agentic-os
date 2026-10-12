#![allow(dead_code)]
//! Shared by the integration tests: a stand-in service run by a real Node.
use mordomo_shell_core::{Config, Payload};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The Node on this machine (`MORDOMO_TEST_NODE`, else the first `node` on PATH). A machine without one fails the
/// tests; it does not skip them.
pub fn node() -> PathBuf {
    if let Some(path) = std::env::var_os("MORDOMO_TEST_NODE") {
        return PathBuf::from(path);
    }
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .expect("the supervisor tests need Node on PATH (or MORDOMO_TEST_NODE)")
}

pub fn fake_entry() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fake_entry.mjs")
}

pub fn config(mode: &str) -> Config {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let mut cfg = Config::new(Payload {
        root,
        node: node(),
        entry: fake_entry(),
    });
    cfg.env.push(("FAKE_MODE".into(), mode.into()));
    cfg.startup_timeout = std::time::Duration::from_secs(20);
    cfg.shutdown_grace = std::time::Duration::from_secs(5);
    cfg
}

pub fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub fn pid_in(lines: &[String]) -> u32 {
    lines
        .iter()
        .find_map(|l| l.strip_prefix("PID "))
        .expect("the stand-in prints its pid first")
        .trim()
        .parse()
        .unwrap()
}

pub fn alive(pid: u32) -> bool {
    if cfg!(windows) {
        let out = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
    } else {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Wait up to `ms` for `pid` to be gone (a killed process is reaped a moment after the signal).
pub fn gone_within(pid: u32, ms: u64) -> bool {
    let until = std::time::Instant::now() + std::time::Duration::from_millis(ms);
    while std::time::Instant::now() < until {
        if !alive(pid) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    !alive(pid)
}
