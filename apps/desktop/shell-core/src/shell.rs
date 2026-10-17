//! What the shell remembers about the service and its window, and what it does to the window when the service starts,
//! fails or ends. It needs no webview: the window is reached through [`ShellWindow`], so every transition runs under
//! `cargo test` with a stand-in window (`tests/shell.rs`). The Tauri shell (`src-tauri/src/shell.rs`) only gives it the
//! real window and calls it.

use crate::failure::Failure;
use crate::policy;
use crate::supervisor::Sidecar;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Mutex, MutexGuard};

/// The one window of the shell, as far as the shell's decisions go.
pub trait ShellWindow {
    /// The address the window shows now (`None`: not known, or there is no window).
    fn address(&self) -> Option<String>;
    /// Send the window to `address`.
    fn go_to(&self, address: &str);
}

#[derive(Debug, Clone)]
pub enum Status {
    Starting,
    Ready,
    Failed(Failure),
}

/// Whether the watch of a running service goes on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Watch {
    /// The service is running (or this tick has nothing to say): look again.
    Continue,
    /// The watch is over: the service ended and was reported, or a later start replaced it.
    Done,
}

struct Inner {
    status: Status,
    sidecar: Option<Sidecar>,
    /// Bumped by every start, so a monitor of an earlier service never reports on a later one.
    generation: u64,
    /// The address of the shell's own screen, to go back to when the service ends.
    local_screen: Option<String>,
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
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The port of the running service, for the address policy (`None`: no service).
    pub fn sidecar_port(&self) -> Option<u16> {
        Some(self.port.load(Ordering::Relaxed)).filter(|p| *p != 0)
    }

    pub fn status(&self) -> Status {
        self.lock().status.clone()
    }

    pub fn is_failed(&self) -> bool {
        matches!(self.lock().status, Status::Failed(_))
    }

    /// Record the address of the shell's own screen: the window, right after it was built.
    pub fn remember_local_screen(&self, address: Option<String>) {
        self.lock().local_screen = address;
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

    /// A start begins: the service of before is stopped, the status is `Starting`, and the number returned belongs to
    /// this start (what [`Shell::start_failed`], [`Shell::start_ready`] and [`Shell::watch`] take back).
    pub fn begin_start(&self) -> u64 {
        self.stop_sidecar();
        let mut inner = self.lock();
        inner.status = Status::Starting;
        inner.generation
    }

    /// The start `generation` failed. Recorded only when no later start or stop has happened. A start that follows a
    /// service that was stopped (an update whose install failed, then a restart that failed too) finds the window on the
    /// old Command Centre: it goes to the shell's own screen, where the failure is shown, unless it is there already.
    pub fn start_failed(&self, generation: u64, failure: Failure, window: &impl ShellWindow) {
        let local = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            inner.status = Status::Failed(failure);
            inner.local_screen.clone()
        };
        let current = window.address();
        if policy::failure_needs_the_shell_screen(current.as_deref(), local.as_deref()) {
            if let Some(local) = local {
                window.go_to(&local);
            }
        }
    }

    /// The start `generation` succeeded: the shell keeps the service, remembers its port, and the window goes to the
    /// service's page. `false` when a later start or stop has happened since (the app is closing): the service is then
    /// dropped, which stops it, and the window stays where it is.
    pub fn start_ready(&self, generation: u64, sidecar: Sidecar, window: &impl ShellWindow) -> bool {
        let launch = sidecar.launch_url();
        let port = sidecar.ready().port;
        {
            let mut inner = self.lock();
            if inner.generation != generation {
                return false;
            }
            self.port.store(port, Ordering::Relaxed);
            inner.sidecar = Some(sidecar);
            inner.status = Status::Ready;
        }
        window.go_to(&launch);
        true
    }

    /// One look at the service of the start `generation`. When it ended without being stopped, the failure is recorded
    /// and the window goes to the shell's own screen, wherever it is, because the page it shows belongs to a dead service.
    pub fn watch(&self, generation: u64, window: &impl ShellWindow) -> Watch {
        let local = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return Watch::Done;
            }
            let Some(sidecar) = inner.sidecar.as_mut() else {
                return Watch::Done;
            };
            if sidecar.is_running() {
                return Watch::Continue;
            }
            let failure = Failure::stopped(sidecar.exit_code(), sidecar.stderr_tail());
            inner.sidecar = None;
            inner.status = Status::Failed(failure);
            self.port.store(0, Ordering::Relaxed);
            inner.local_screen.clone()
        };
        if let Some(local) = local {
            window.go_to(&local);
        }
        Watch::Done
    }
}
