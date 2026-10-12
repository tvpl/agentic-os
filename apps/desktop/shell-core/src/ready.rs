use serde::Deserialize;
use std::fmt;

/// The prefix of the one line the service prints on stdout when it listens.
pub const READY_PREFIX: &str = "MORDOMO_READY ";

/// What the service says about itself in that line (`v` 1; `.specs/features/distribuicao`, door 7).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Ready {
    pub v: u32,
    pub pid: u32,
    pub port: u16,
    pub version: String,
    /// The `updates.check` setting: whether the owner asked for update checks at start.
    #[serde(rename = "updatesCheck")]
    pub updates_check: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyError {
    NotAReadyLine,
    Malformed(String),
    UnsupportedVersion(u32),
    PortZero,
}

impl fmt::Display for ReadyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadyError::NotAReadyLine => write!(f, "not a {}line", READY_PREFIX),
            ReadyError::Malformed(why) => write!(f, "malformed ready line: {why}"),
            ReadyError::UnsupportedVersion(v) => write!(f, "ready line version {v} is not 1"),
            ReadyError::PortZero => write!(f, "ready line names port 0"),
        }
    }
}

/// Read one stdout line. Only `MORDOMO_READY {json}` with `v` 1 and a port of 1..=65535 is a ready line.
pub fn parse_ready_line(line: &str) -> Result<Ready, ReadyError> {
    let body = line
        .trim_end_matches(['\r', '\n'])
        .strip_prefix(READY_PREFIX)
        .ok_or(ReadyError::NotAReadyLine)?;
    let ready: Ready = serde_json::from_str(body).map_err(|e| ReadyError::Malformed(e.to_string()))?;
    if ready.v != 1 {
        return Err(ReadyError::UnsupportedVersion(ready.v));
    }
    if ready.port == 0 {
        return Err(ReadyError::PortZero);
    }
    Ok(ready)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str =
        r#"MORDOMO_READY {"v":1,"pid":4242,"port":46677,"version":"0.8.0","updatesCheck":true}"#;

    #[test]
    fn a_well_formed_line_gives_every_field() {
        let r = parse_ready_line(GOOD).unwrap();
        assert_eq!(
            r,
            Ready {
                v: 1,
                pid: 4242,
                port: 46677,
                version: "0.8.0".into(),
                updates_check: true
            }
        );
        // The service's own newline (and a Windows one) is not part of the JSON.
        assert_eq!(parse_ready_line(&format!("{GOOD}\n")).unwrap(), r);
        assert_eq!(parse_ready_line(&format!("{GOOD}\r\n")).unwrap(), r);
    }

    #[test]
    fn the_edge_ports_are_accepted_and_the_ends_outside_are_not() {
        let line = |port: &str| {
            format!(r#"MORDOMO_READY {{"v":1,"pid":1,"port":{port},"version":"x","updatesCheck":false}}"#)
        };
        assert_eq!(parse_ready_line(&line("1")).unwrap().port, 1);
        assert_eq!(parse_ready_line(&line("65535")).unwrap().port, 65535);
        assert_eq!(parse_ready_line(&line("0")), Err(ReadyError::PortZero));
        assert!(matches!(
            parse_ready_line(&line("65536")),
            Err(ReadyError::Malformed(_))
        ));
        assert!(matches!(
            parse_ready_line(&line("-1")),
            Err(ReadyError::Malformed(_))
        ));
        assert!(matches!(
            parse_ready_line(&line("\"80\"")),
            Err(ReadyError::Malformed(_))
        ));
    }

    #[test]
    fn anything_else_is_rejected() {
        assert_eq!(
            parse_ready_line("[mordomo] running at http://127.0.0.1:1"),
            Err(ReadyError::NotAReadyLine)
        );
        assert_eq!(parse_ready_line(""), Err(ReadyError::NotAReadyLine));
        // The prefix is exact: no leading space, no other case, no missing separator.
        assert_eq!(
            parse_ready_line(&format!(" {GOOD}")),
            Err(ReadyError::NotAReadyLine)
        );
        assert_eq!(
            parse_ready_line(&GOOD.to_lowercase()),
            Err(ReadyError::NotAReadyLine)
        );
        assert_eq!(
            parse_ready_line(&GOOD.replacen("READY ", "READY", 1)),
            Err(ReadyError::NotAReadyLine)
        );
        assert!(matches!(
            parse_ready_line("MORDOMO_READY {not json"),
            Err(ReadyError::Malformed(_))
        ));
        assert!(matches!(
            parse_ready_line("MORDOMO_READY "),
            Err(ReadyError::Malformed(_))
        ));
        assert_eq!(
            parse_ready_line(&GOOD.replace("\"v\":1", "\"v\":2")),
            Err(ReadyError::UnsupportedVersion(2))
        );
        for missing in [
            "\"v\":1,",
            "\"pid\":4242,",
            "\"port\":46677,",
            "\"version\":\"0.8.0\",",
            ",\"updatesCheck\":true",
        ] {
            assert!(
                matches!(
                    parse_ready_line(&GOOD.replace(missing, "")),
                    Err(ReadyError::Malformed(_))
                ),
                "without {missing}"
            );
        }
    }
}
