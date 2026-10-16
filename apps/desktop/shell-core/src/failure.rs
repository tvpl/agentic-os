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
