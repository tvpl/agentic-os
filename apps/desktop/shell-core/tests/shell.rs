//! What the shell does to its window when the service starts, fails or ends (`src/shell.rs`), run against a stand-in
//! window and a stand-in service. The Tauri side only gives it the real window (.specs/features/distribuicao, C64).
mod common;

use common::config;
use mordomo_shell_core::shell::{Shell, ShellWindow, Status, Watch};
use mordomo_shell_core::{Failure, FailureKind, LaunchToken, Sidecar};
use std::cell::RefCell;
use std::time::{Duration, Instant};

const LOCAL: &str = "tauri://localhost/";
const SERVICE_PAGE: &str = "http://127.0.0.1:41234/settings";

/// A window that shows `shown` and remembers where it was sent.
struct Window {
    shown: Option<&'static str>,
    sent: RefCell<Vec<String>>,
}

impl Window {
    fn on(shown: &'static str) -> Self {
        Self {
            shown: Some(shown),
            sent: RefCell::default(),
        }
    }

    fn unknown() -> Self {
        Self {
            shown: None,
            sent: RefCell::default(),
        }
    }

    fn sent(&self) -> Vec<String> {
        self.sent.borrow().clone()
    }
}

impl ShellWindow for Window {
    fn address(&self) -> Option<String> {
        self.shown.map(String::from)
    }

    fn go_to(&self, address: &str) {
        self.sent.borrow_mut().push(address.to_string());
    }
}

fn failure() -> Failure {
    Failure {
        kind: FailureKind::Crashed,
        detail: "exit code 1".into(),
        tail: vec![],
    }
}

fn shell_with_screen() -> Shell {
    let shell = Shell::default();
    shell.remember_local_screen(Some(LOCAL.to_string()));
    shell
}

fn started(mode: &str) -> Sidecar {
    Sidecar::start(&config(mode), &LaunchToken::generate().unwrap()).unwrap()
}

fn failed_kind(shell: &Shell) -> Option<FailureKind> {
    match shell.status() {
        Status::Failed(f) => Some(f.kind),
        _ => None,
    }
}

// ---- a start that fails ---------------------------------------------------------------------------------------

#[test]
fn the_first_start_that_fails_records_the_failure_and_leaves_the_window_on_the_shells_screen() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    let window = Window::on(LOCAL);
    shell.start_failed(generation, failure(), &window);
    assert_eq!(failed_kind(&shell), Some(FailureKind::Crashed));
    assert_eq!(window.sent(), Vec::<String>::new());
}

#[test]
fn a_restart_that_fails_over_the_command_centre_moves_the_window_to_the_shells_own_screen() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    let window = Window::on(SERVICE_PAGE);
    shell.start_failed(generation, failure(), &window);
    assert_eq!(failed_kind(&shell), Some(FailureKind::Crashed));
    // exactly the shell's own screen, which is what `remember_local_screen` was given
    assert_eq!(window.sent(), vec![LOCAL.to_string()]);
}

#[test]
fn a_restart_that_fails_while_the_page_of_the_window_is_not_known_moves_it_to_the_shells_screen() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    let window = Window::unknown();
    shell.start_failed(generation, failure(), &window);
    assert_eq!(window.sent(), vec![LOCAL.to_string()]);
}

#[test]
fn with_no_shell_screen_recorded_a_failed_start_has_nowhere_to_move_the_window() {
    let shell = Shell::default();
    let generation = shell.begin_start();
    let window = Window::on(SERVICE_PAGE);
    shell.start_failed(generation, failure(), &window);
    assert_eq!(failed_kind(&shell), Some(FailureKind::Crashed));
    assert_eq!(window.sent(), Vec::<String>::new());
}

#[test]
fn the_failure_of_a_start_that_a_later_start_replaced_is_not_recorded_and_moves_nothing() {
    let shell = shell_with_screen();
    let old = shell.begin_start();
    let current = shell.begin_start();
    assert_ne!(old, current);
    let window = Window::on(SERVICE_PAGE);
    shell.start_failed(old, failure(), &window);
    assert!(matches!(shell.status(), Status::Starting));
    assert!(!shell.is_failed());
    assert_eq!(window.sent(), Vec::<String>::new());
    // the current one still counts
    shell.start_failed(current, failure(), &window);
    assert!(shell.is_failed());
    assert_eq!(window.sent(), vec![LOCAL.to_string()]);
}

// ---- a start that succeeds -------------------------------------------------------------------------------------

#[test]
fn a_start_that_succeeds_keeps_the_service_opens_its_port_to_the_policy_and_sends_the_window_to_its_page() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    assert_eq!(shell.sidecar_port(), None);
    let sidecar = started("ok");
    let (port, launch) = (sidecar.port(), sidecar.launch_url());
    let window = Window::on(LOCAL);
    assert!(shell.start_ready(generation, sidecar, &window));
    assert!(matches!(shell.status(), Status::Ready));
    assert_eq!(shell.sidecar_port(), Some(port));
    assert_eq!(window.sent(), vec![launch]);
    // and a stop takes the port away again, with the service
    shell.stop_sidecar();
    assert_eq!(shell.sidecar_port(), None);
}

#[test]
fn a_service_that_started_after_the_app_began_to_close_is_dropped_and_the_window_stays_where_it_is() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    shell.stop_sidecar(); // the app is closing
    let window = Window::on(LOCAL);
    assert!(!shell.start_ready(generation, started("ok"), &window));
    assert!(matches!(shell.status(), Status::Starting));
    assert_eq!(shell.sidecar_port(), None);
    assert_eq!(window.sent(), Vec::<String>::new());
}

#[test]
fn a_new_start_stops_the_service_of_before_and_the_watch_of_that_service_is_over() {
    let shell = shell_with_screen();
    let first = shell.begin_start();
    let window = Window::on(LOCAL);
    assert!(shell.start_ready(first, started("ok"), &window));
    assert!(shell.sidecar_port().is_some());
    let second = shell.begin_start();
    assert_ne!(first, second);
    assert_eq!(shell.sidecar_port(), None);
    assert!(matches!(shell.status(), Status::Starting));
    assert_eq!(shell.watch(first, &window), Watch::Done);
    assert!(!shell.is_failed());
}

// ---- a service that ends ---------------------------------------------------------------------------------------

fn until_watch_is_done(shell: &Shell, generation: u64, window: &Window) {
    let until = Instant::now() + Duration::from_secs(5);
    while shell.watch(generation, window) == Watch::Continue {
        assert!(Instant::now() < until, "the stand-in service never ended");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_running_service_is_watched_on_and_nothing_moves() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    let window = Window::on(SERVICE_PAGE);
    assert!(shell.start_ready(generation, started("ok"), &window));
    let before = window.sent();
    assert_eq!(shell.watch(generation, &window), Watch::Continue);
    assert!(matches!(shell.status(), Status::Ready));
    assert_eq!(window.sent(), before);
    shell.stop_sidecar();
}

#[test]
fn a_service_that_ends_by_itself_is_reported_as_stopped_and_the_window_goes_to_the_shells_screen() {
    let shell = shell_with_screen();
    let generation = shell.begin_start();
    let window = Window::on(LOCAL);
    assert!(shell.start_ready(generation, started("dies"), &window));
    let after_ready = window.sent().len();
    until_watch_is_done(&shell, generation, &window);
    match shell.status() {
        Status::Failed(f) => {
            assert_eq!(f.kind, FailureKind::Stopped);
            assert_eq!(f.detail, "exit code 7");
        }
        other => panic!("expected the failure, got {other:?}"),
    }
    assert_eq!(shell.sidecar_port(), None);
    assert_eq!(window.sent()[after_ready..], [LOCAL.to_string()]);
    // reported once: the next look has nothing to do
    assert_eq!(shell.watch(generation, &window), Watch::Done);
    assert_eq!(window.sent().len(), after_ready + 1);
}

#[test]
fn a_service_that_ends_with_no_shell_screen_recorded_is_reported_and_the_window_is_left_alone() {
    let shell = Shell::default();
    let generation = shell.begin_start();
    let window = Window::on(SERVICE_PAGE);
    assert!(shell.start_ready(generation, started("dies"), &window));
    let after_ready = window.sent().len();
    until_watch_is_done(&shell, generation, &window);
    assert_eq!(failed_kind(&shell), Some(FailureKind::Stopped));
    assert_eq!(window.sent().len(), after_ready);
}

#[test]
fn the_watch_of_a_service_that_a_later_start_replaced_reports_nothing() {
    let shell = shell_with_screen();
    let first = shell.begin_start();
    let window = Window::on(LOCAL);
    assert!(shell.start_ready(first, started("dies"), &window));
    let second = shell.begin_start(); // stops the dying service of `first`, quietly
    let after_ready = window.sent().len();
    assert_eq!(shell.watch(first, &window), Watch::Done);
    assert!(matches!(shell.status(), Status::Starting));
    assert!(!shell.is_failed());
    assert_eq!(window.sent().len(), after_ready);
    let _ = second;
}

#[test]
fn the_watch_of_an_earlier_start_never_reports_on_the_service_of_a_later_one() {
    let shell = shell_with_screen();
    let first = shell.begin_start();
    let window = Window::on(LOCAL);
    assert!(shell.start_ready(first, started("ok"), &window));
    let second = shell.begin_start();
    assert!(shell.start_ready(second, started("dies"), &window));
    let after_ready = window.sent().len();
    // the later service ends; only its own watch may say so
    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(shell.watch(first, &window), Watch::Done);
    assert!(matches!(shell.status(), Status::Ready));
    assert!(shell.sidecar_port().is_some());
    assert_eq!(window.sent().len(), after_ready);
    until_watch_is_done(&shell, second, &window);
    assert_eq!(failed_kind(&shell), Some(FailureKind::Stopped));
}
