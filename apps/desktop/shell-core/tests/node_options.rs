//! Alone in its process: it sets an environment variable of the whole test process.
mod common;

use common::config;
use mordomo_shell_core::{LaunchToken, Sidecar};

#[test]
fn node_options_of_the_shells_environment_never_reach_the_service() {
    std::env::set_var("NODE_OPTIONS", "--max-old-space-size=64");
    let mut sidecar = Sidecar::start(&config("ok"), &LaunchToken::generate().unwrap()).unwrap();
    assert!(sidecar.stdout_tail().contains(&"NODE_OPTIONS unset".to_string()));
    sidecar.stop();
}
