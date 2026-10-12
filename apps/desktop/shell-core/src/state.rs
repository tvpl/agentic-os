use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;

/// The one thing the shell remembers between launches: the port its service listened on. The Command Centre keeps
/// its preferences in `localStorage`, which belongs to an origin, and an origin includes the port: asking the system
/// for a new port each time would hand every launch an empty `localStorage`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopState {
    pub port: Option<u16>,
}

/// Ports below this belong to the system's own services; the shell neither asks for nor remembers one of them.
pub const FIRST_USER_PORT: u16 = 1024;

impl DesktopState {
    /// What `path` holds; a missing, unreadable or damaged file, and a port that cannot be one, read as no preference.
    pub fn load(path: &Path) -> Self {
        let state: DesktopState = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            port: state.port.filter(|p| *p >= FIRST_USER_PORT),
        }
    }

    /// Write it next to its final name and rename over it, so a crash leaves the old file or the new one.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = path.with_extension("json.tmp");
        {
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(
                serde_json::to_string_pretty(self)
                    .map_err(std::io::Error::other)?
                    .as_bytes(),
            )?;
            file.sync_all()?;
        }
        std::fs::rename(&temporary, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::tempdir;

    #[test]
    fn a_saved_port_is_read_back() {
        let dir = tempdir("state-roundtrip");
        let file = dir.join("nested").join("desktop-state.json");
        DesktopState { port: Some(41234) }.save(&file).unwrap();
        assert_eq!(DesktopState::load(&file), DesktopState { port: Some(41234) });
        assert!(!file.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nothing_usable_reads_as_no_preference() {
        let dir = tempdir("state-bad");
        let file = dir.join("desktop-state.json");
        assert_eq!(DesktopState::load(&file), DesktopState::default());
        for text in [
            "",
            "{",
            "[]",
            "null",
            r#"{"port":"80"}"#,
            r#"{"port":70000}"#,
            r#"{"port":-1}"#,
            r#"{"port":0}"#,
            r#"{"port":80}"#,
            r#"{"port":1023}"#,
        ] {
            std::fs::write(&file, text).unwrap();
            assert_eq!(DesktopState::load(&file), DesktopState::default(), "{text}");
        }
        std::fs::write(&file, r#"{"port":1024,"extra":true}"#).unwrap();
        assert_eq!(DesktopState::load(&file).port, Some(1024));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
