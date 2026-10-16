//! The part of the MordomoOS desktop shell that needs no webview: the launch secret, the sidecar's ready line, the
//! supervisor that starts, watches and stops the bundled local service, and the rule that says which addresses the
//! window may load. `cargo test -p mordomo-shell-core` runs it all without GTK, WebKit or a display.
//!
//! The contract with the service (`mordomo start --foreground --sidecar`) is `.specs/features/distribuicao`, door 7:
//! the secret travels in `MORDOMO_LAUNCH_TOKEN`, the service says `MORDOMO_READY {json}` once it listens and shuts
//! down when its stdin closes.

pub mod failure;
pub mod nav;
pub mod payload;
pub mod policy;
pub mod probe;
pub mod ready;
pub mod state;
pub mod supervisor;
pub mod token;

#[cfg(test)]
mod testutil;

pub use failure::{Failure, FailureKind};
pub use nav::{decide, on_navigation, on_new_window, Handling, NavAction};
pub use payload::{Payload, PayloadError};
pub use ready::{parse_ready_line, Ready, ReadyError, READY_PREFIX};
pub use supervisor::{Config, Sidecar, StartError, StopOutcome};
pub use token::LaunchToken;
