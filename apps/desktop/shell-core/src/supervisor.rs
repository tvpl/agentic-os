use crate::payload::{Payload, PayloadError};
use crate::probe::{wait_for_ui, ProbeError};
use crate::ready::{parse_ready_line, Ready, ReadyError, READY_PREFIX};
use crate::token::LaunchToken;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// How many lines of the service's stdout and stderr are kept for the failure screen.
const TAIL_LINES: usize = 20;
/// A line is cut here before it is kept: the screen shows a diagnosis, not a log.
const TAIL_LINE_CHARS: usize = 400;

pub const DEFAULT_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
/// The service waits up to 10 s for runs to end (`runs.shutdown(10_000)`); this gives it a margin before the kill.
pub const DEFAULT_SHUTDOWN_GRACE: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub struct Config {
    pub payload: Payload,
    /// The port asked for first (the last one used, so the Command Centre keeps one origin and its `localStorage`);
    /// `None` asks the system. A busy preferred port falls back to the system's choice, once.
    pub preferred_port: Option<u16>,
    pub startup_timeout: Duration,
    pub shutdown_grace: Duration,
    /// Extra variables for the service's environment (a home folder in a test, for instance).
    pub env: Vec<(String, String)>,
}

impl Config {
    pub fn new(payload: Payload) -> Self {
        Self {
            payload,
            preferred_port: None,
            startup_timeout: DEFAULT_STARTUP_TIMEOUT,
            shutdown_grace: DEFAULT_SHUTDOWN_GRACE,
            env: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub enum StartError {
    Payload(PayloadError),
    Spawn(String),
    /// The service ended before it said it listened. `code` is its exit code (`None`: ended by a signal).
    ExitedEarly {
        code: Option<i32>,
        stderr: Vec<String>,
        stdout: Vec<String>,
    },
    Timeout {
        stderr: Vec<String>,
        stdout: Vec<String>,
    },
    BadReady {
        line: String,
        why: ReadyError,
        stderr: Vec<String>,
    },
    Ui {
        why: ProbeError,
        stderr: Vec<String>,
    },
}

impl From<PayloadError> for StartError {
    fn from(e: PayloadError) -> Self {
        StartError::Payload(e)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopOutcome {
    /// It ended by itself after its stdin closed; its exit code.
    Exited(Option<i32>),
    /// It was still there after the grace period and was killed.
    Killed,
}

type Tail = Arc<Mutex<VecDeque<String>>>;

fn push_tail(tail: &Tail, line: &str) {
    let mut line = line.trim_end().to_string();
    if line.chars().count() > TAIL_LINE_CHARS {
        line = line.chars().take(TAIL_LINE_CHARS).collect::<String>() + "…";
    }
    let mut lines = tail.lock().unwrap_or_else(|p| p.into_inner());
    if lines.len() == TAIL_LINES {
        lines.pop_front();
    }
    lines.push_back(line);
}

fn snapshot(tail: &Tail) -> Vec<String> {
    tail.lock()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .cloned()
        .collect()
}

enum Event {
    Ready(Ready),
    BadReady(String, ReadyError),
}

/// The bundled service while it runs: owned by the shell, stopped when the shell stops it or drops it.
#[derive(Debug)]
pub struct Sidecar {
    child: Child,
    stdin: Option<ChildStdin>,
    ready: Ready,
    token: LaunchToken,
    stderr: Tail,
    stdout: Tail,
    grace: Duration,
    outcome: Option<StopOutcome>,
}

impl Sidecar {
    /// Start the service asking for `cfg.preferred_port`; when that port is busy (exit 5), once more with the system's
    /// choice.
    pub fn start(cfg: &Config, token: &LaunchToken) -> Result<Self, StartError> {
        match Self::start_on(cfg, token, cfg.preferred_port) {
            Err(StartError::ExitedEarly { code: Some(5), .. }) if cfg.preferred_port.is_some() => {
                Self::start_on(cfg, token, None)
            }
            other => other,
        }
    }

    /// One attempt, on `port` (`None`: the system chooses). Returns only after the service said it listens
    /// and answered `GET /` with the Command Centre's page.
    pub fn start_on(cfg: &Config, token: &LaunchToken, port: Option<u16>) -> Result<Self, StartError> {
        // The payload may have been damaged since the app opened (a half-finished update): look again.
        cfg.payload.verify()?;
        let payload = &cfg.payload;
        let mut command = Command::new(&payload.node);
        command
            .arg(&payload.entry)
            .args(["start", "--foreground", "--sidecar", "--port"])
            .arg(port.unwrap_or(0).to_string())
            .current_dir(&payload.root)
            // The secret is in the environment, never in argv (a process list shows argv to every user).
            .env("MORDOMO_LAUNCH_TOKEN", token.expose())
            // A variable that makes Node load someone's code first has no place in the signed service.
            .env_remove("NODE_OPTIONS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in &cfg.env {
            command.env(key, value);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .spawn()
            .map_err(|e| StartError::Spawn(format!("{}: {e}", payload.node.display())))?;
        let stdin = child.stdin.take();
        let stderr: Tail = Arc::default();
        let stdout: Tail = Arc::default();
        let (events, inbox) = mpsc::channel::<Event>();

        // Both pipes are drained for as long as the service lives: a full pipe would stop it.
        let out_reader = child.stdout.take().map(|pipe| {
            let tail = Arc::clone(&stdout);
            thread::spawn(move || {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    if line.starts_with(READY_PREFIX) {
                        let _ = events.send(match parse_ready_line(&line) {
                            Ok(ready) => Event::Ready(ready),
                            Err(why) => Event::BadReady(line.clone(), why),
                        });
                    } else {
                        push_tail(&tail, &line);
                    }
                }
            })
        });
        let err_reader: Option<JoinHandle<()>> = child.stderr.take().map(|pipe| {
            let tail = Arc::clone(&stderr);
            thread::spawn(move || {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    push_tail(&tail, &line);
                }
            })
        });
        let mut service = PendingChild {
            child: Some(child),
            err_reader,
            out_reader,
        };

        let deadline = Instant::now() + cfg.startup_timeout;
        let ready = loop {
            match inbox.recv_timeout(Duration::from_millis(50)) {
                Ok(Event::Ready(ready)) => break ready,
                Ok(Event::BadReady(line, why)) => {
                    service.kill();
                    return Err(StartError::BadReady {
                        line,
                        why,
                        stderr: snapshot(&stderr),
                    });
                }
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
                    if let Some(status) = service.try_wait() {
                        service.settle_readers();
                        return Err(StartError::ExitedEarly {
                            code: status.code(),
                            stderr: snapshot(&stderr),
                            stdout: snapshot(&stdout),
                        });
                    }
                    if Instant::now() >= deadline {
                        service.kill();
                        return Err(StartError::Timeout {
                            stderr: snapshot(&stderr),
                            stdout: snapshot(&stdout),
                        });
                    }
                }
            }
        };

        let mut gone = false;
        let probed = wait_for_ui(
            ready.port,
            deadline.max(Instant::now() + Duration::from_secs(2)),
            || {
                gone = gone || service.try_wait().is_some();
                !gone
            },
        );
        if let Err(why) = probed {
            if gone {
                service.settle_readers();
            } else {
                service.kill();
            }
            return Err(StartError::Ui {
                why,
                stderr: snapshot(&stderr),
            });
        }

        Ok(Sidecar {
            child: service.release(),
            stdin,
            ready,
            token: token.clone(),
            stderr,
            stdout,
            grace: cfg.shutdown_grace,
            outcome: None,
        })
    }

    pub fn ready(&self) -> &Ready {
        &self.ready
    }

    pub fn port(&self) -> u16 {
        self.ready.port
    }

    /// `http://127.0.0.1:<port>`: the origin the window may load.
    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.ready.port)
    }

    /// The first address of the window: the origin with the launch secret, which the service trades for a cookie and
    /// a redirect, so the secret is in this one URL and in no other.
    pub fn launch_url(&self) -> String {
        format!("{}/?launch={}", self.origin(), self.token.expose())
    }

    /// Whether the service is still running.
    pub fn is_running(&mut self) -> bool {
        self.outcome.is_none() && matches!(self.child.try_wait(), Ok(None))
    }

    /// The exit code of a service that ended without being stopped (`None` while it runs or after a signal).
    pub fn exit_code(&mut self) -> Option<i32> {
        self.child.try_wait().ok().flatten().and_then(|s| s.code())
    }

    pub fn stderr_tail(&self) -> Vec<String> {
        snapshot(&self.stderr)
    }

    pub fn stdout_tail(&self) -> Vec<String> {
        snapshot(&self.stdout)
    }

    /// Close the service's stdin (its signal to shut down), wait for it up to the grace period, and kill it only
    /// then. Idempotent: the second call returns what the first did.
    pub fn stop(&mut self) -> StopOutcome {
        if let Some(outcome) = &self.outcome {
            return outcome.clone();
        }
        drop(self.stdin.take());
        let deadline = Instant::now() + self.grace;
        let outcome = loop {
            match self.child.try_wait() {
                Ok(Some(status)) => break StopOutcome::Exited(status.code()),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break StopOutcome::Killed;
                }
            }
        };
        self.outcome = Some(outcome.clone());
        outcome
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

/// A child that is not yet a `Sidecar`: whatever way `start_on` leaves, it is not left running or unreaped.
struct PendingChild {
    child: Option<Child>,
    err_reader: Option<JoinHandle<()>>,
    out_reader: Option<JoinHandle<()>>,
}

impl PendingChild {
    fn try_wait(&mut self) -> Option<std::process::ExitStatus> {
        self.child.as_mut().and_then(|c| c.try_wait().ok().flatten())
    }

    fn kill(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.settle_readers();
    }

    /// Give the readers a moment to hand over the last lines the dead process wrote (they end at the pipe's EOF).
    fn settle_readers(&mut self) {
        let until = Instant::now() + Duration::from_millis(500);
        for reader in [self.err_reader.take(), self.out_reader.take()]
            .into_iter()
            .flatten()
        {
            while !reader.is_finished() && Instant::now() < until {
                thread::sleep(Duration::from_millis(10));
            }
            if reader.is_finished() {
                let _ = reader.join();
            }
        }
    }

    fn release(mut self) -> Child {
        self.child.take().expect("the child is released once")
    }
}

impl Drop for PendingChild {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
