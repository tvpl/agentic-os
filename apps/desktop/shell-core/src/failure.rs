use crate::payload::PayloadError;
use crate::probe::ProbeError;
use crate::supervisor::StartError;
use serde::Serialize;

/// Why the service is not there. The screen has a sentence for each kind, in English and Portuguese
/// (`apps/desktop/ui/shell.js`); the shell only names the kind and passes the facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// `runtime/` or `lib/` is missing from the installed app.
    PayloadMissing,
    /// The operating system would not start the Node binary.
    SpawnFailed,
    /// Another MordomoOS service holds this home (exit 4).
    HomeInUse,
    /// A restore left the home in a state nothing may continue over (exit 3).
    HomeBlocked,
    /// The port asked for is taken and so was the fallback (exit 5 twice).
    PortBusy,
    /// The service ended before it listened, for any other reason.
    Crashed,
    /// It did not listen within the startup time.
    Timeout,
    /// It said something the shell does not understand.
    BadReady,
    /// It listens, but does not serve the Command Centre.
    UiNotServed,
    /// It was running and ended.
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Failure {
    pub kind: FailureKind,
    /// One line of fact: a path, an exit code, the operating system's words.
    pub detail: String,
    /// The last lines the service wrote on stderr (at most 20, each cut at 400 characters).
    pub tail: Vec<String>,
}

impl Failure {
    pub fn stopped(code: Option<i32>, tail: Vec<String>) -> Self {
        let detail = match code {
            Some(c) => format!("exit code {c}"),
            None => "ended by a signal".to_string(),
        };
        Self {
            kind: FailureKind::Stopped,
            detail,
            tail,
        }
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

impl From<&StartError> for Failure {
    fn from(error: &StartError) -> Self {
        match error {
            StartError::Payload(PayloadError { missing }) => Failure {
                kind: FailureKind::PayloadMissing,
                detail: missing.display().to_string(),
                tail: vec![],
            },
            StartError::Spawn(why) => Failure {
                kind: FailureKind::SpawnFailed,
                detail: why.clone(),
                tail: vec![],
            },
            StartError::ExitedEarly { code, stderr, .. } => {
                let kind = match code {
                    Some(4) => FailureKind::HomeInUse,
                    Some(3) => FailureKind::HomeBlocked,
                    Some(5) => FailureKind::PortBusy,
                    _ => FailureKind::Crashed,
                };
                let detail = match code {
                    Some(c) => format!("exit code {c}"),
                    None => "ended by a signal".to_string(),
                };
                Failure {
                    kind,
                    detail,
                    tail: stderr.clone(),
                }
            }
            StartError::Timeout { stderr, .. } => Failure {
                kind: FailureKind::Timeout,
                detail: "no answer within the startup time".to_string(),
                tail: stderr.clone(),
            },
            StartError::BadReady { line, why, stderr } => Failure {
                kind: FailureKind::BadReady,
                detail: format!("{why}: {}", line.chars().take(200).collect::<String>()),
                tail: stderr.clone(),
            },
            StartError::Ui { why, stderr } => Failure {
                kind: match why {
                    ProbeError::Io(_) => FailureKind::Crashed,
                    _ => FailureKind::UiNotServed,
                },
                detail: why.to_string(),
                tail: stderr.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ready::ReadyError;
    use std::path::PathBuf;

    fn tail() -> Vec<String> {
        vec!["boom".to_string()]
    }

    fn early(code: Option<i32>) -> StartError {
        StartError::ExitedEarly {
            code,
            stderr: tail(),
            stdout: vec![],
        }
    }

    #[test]
    fn a_service_that_was_running_and_ended_is_stopped_with_its_exit_code_or_signal() {
        let by_code = Failure::stopped(Some(1), tail());
        assert_eq!(by_code.kind, FailureKind::Stopped);
        assert_eq!(by_code.detail, "exit code 1");
        assert_eq!(by_code.tail, tail());
        let by_signal = Failure::stopped(None, vec![]);
        assert_eq!(by_signal.kind, FailureKind::Stopped);
        assert_eq!(by_signal.detail, "ended by a signal");
        assert!(by_signal.tail.is_empty());
        // the kind is the one the screen has a sentence for
        assert_eq!(by_code.to_json()["kind"], "stopped");
    }

    #[test]
    fn exit_codes_before_the_service_listened_name_the_kind_the_screen_explains() {
        for (code, kind) in [
            (Some(4), FailureKind::HomeInUse),
            (Some(3), FailureKind::HomeBlocked),
            (Some(5), FailureKind::PortBusy),
            (Some(1), FailureKind::Crashed),
            (Some(0), FailureKind::Crashed),
            (None, FailureKind::Crashed),
        ] {
            let failure = Failure::from(&early(code));
            assert_eq!(failure.kind, kind, "{code:?}");
            assert_eq!(failure.tail, tail(), "{code:?}");
        }
        assert_eq!(Failure::from(&early(Some(4))).detail, "exit code 4");
        assert_eq!(Failure::from(&early(None)).detail, "ended by a signal");
    }

    #[test]
    fn the_other_start_errors_keep_their_kind_their_fact_and_their_tail() {
        let missing = Failure::from(&StartError::Payload(PayloadError {
            missing: PathBuf::from("/app/payload/runtime"),
        }));
        assert_eq!(missing.kind, FailureKind::PayloadMissing);
        assert_eq!(missing.detail, "/app/payload/runtime");
        assert!(missing.tail.is_empty());

        let spawn = Failure::from(&StartError::Spawn("permission denied".to_string()));
        assert_eq!(spawn.kind, FailureKind::SpawnFailed);
        assert_eq!(spawn.detail, "permission denied");

        let timeout = Failure::from(&StartError::Timeout {
            stderr: tail(),
            stdout: vec![],
        });
        assert_eq!(timeout.kind, FailureKind::Timeout);
        assert_eq!(timeout.detail, "no answer within the startup time");
        assert_eq!(timeout.tail, tail());

        let long = "x".repeat(500);
        let bad = Failure::from(&StartError::BadReady {
            line: long,
            why: ReadyError::PortZero,
            stderr: tail(),
        });
        assert_eq!(bad.kind, FailureKind::BadReady);
        assert_eq!(
            bad.detail,
            format!("ready line names port 0: {}", "x".repeat(200))
        );
        assert_eq!(bad.tail, tail());
    }

    #[test]
    fn a_service_that_listens_but_serves_the_wrong_thing_is_ui_not_served_and_one_that_does_not_answer_is_crashed(
    ) {
        for why in [
            ProbeError::Status(404),
            ProbeError::NotHtml("application/json".to_string()),
            ProbeError::NotHttp,
        ] {
            let failure = Failure::from(&StartError::Ui {
                why: why.clone(),
                stderr: tail(),
            });
            assert_eq!(failure.kind, FailureKind::UiNotServed, "{why:?}");
            assert_eq!(failure.detail, why.to_string());
            assert_eq!(failure.tail, tail());
        }
        let io = Failure::from(&StartError::Ui {
            why: ProbeError::Io("connection refused".to_string()),
            stderr: tail(),
        });
        assert_eq!(io.kind, FailureKind::Crashed);
        assert_eq!(io.detail, "the service does not answer: connection refused");
    }

    #[test]
    fn every_kind_serializes_as_the_snake_case_name_the_screen_looks_up() {
        for (kind, name) in [
            (FailureKind::PayloadMissing, "payload_missing"),
            (FailureKind::SpawnFailed, "spawn_failed"),
            (FailureKind::HomeInUse, "home_in_use"),
            (FailureKind::HomeBlocked, "home_blocked"),
            (FailureKind::PortBusy, "port_busy"),
            (FailureKind::Crashed, "crashed"),
            (FailureKind::Timeout, "timeout"),
            (FailureKind::BadReady, "bad_ready"),
            (FailureKind::UiNotServed, "ui_not_served"),
            (FailureKind::Stopped, "stopped"),
        ] {
            let json = Failure {
                kind,
                detail: String::new(),
                tail: vec![],
            }
            .to_json();
            assert_eq!(json["kind"], name);
        }
    }
}
