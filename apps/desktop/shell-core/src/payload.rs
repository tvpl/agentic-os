use std::fmt;
use std::path::{Path, PathBuf};

/// The bundled service on disk: the `payload/` folder `scripts/package.mjs --payload` writes and the installer
/// carries (`lib/mordomo.mjs`, `runtime/` with the Node binary, `ui/`, `seed/`, `legal/`).
#[derive(Debug, Clone)]
pub struct Payload {
    pub root: PathBuf,
    pub node: PathBuf,
    pub entry: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadError {
    pub missing: PathBuf,
}

impl fmt::Display for PayloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} is missing from the installed app", self.missing.display())
    }
}

impl Payload {
    /// The paths inside `root`, which must exist: the shell never falls back to a Node found on the machine, because
    /// the service it runs is the one the installer signed and shipped, with the SQLite addon built for that Node.
    pub fn at(root: &Path) -> Result<Self, PayloadError> {
        // Absolute: the service is started with the payload as its working folder, and a relative path to the Node binary
        // would then be looked up from there.
        let root = std::path::absolute(root).unwrap_or_else(|_| root.to_path_buf());
        let root = root.as_path();
        let node = if cfg!(windows) {
            root.join("runtime").join("node.exe")
        } else {
            root.join("runtime").join("bin").join("node")
        };
        let entry = root.join("lib").join("mordomo.mjs");
        let payload = Self {
            root: root.to_path_buf(),
            node,
            entry,
        };
        payload.verify()?;
        Ok(payload)
    }

    /// Both files are there (again: a half-finished update can take them away after the app opened).
    pub fn verify(&self) -> Result<(), PayloadError> {
        for needed in [&self.node, &self.entry] {
            if !needed.is_file() {
                return Err(PayloadError {
                    missing: needed.clone(),
                });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{fake_payload, tempdir};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn a_complete_payload_is_found() {
        let dir = tempdir("complete");
        let p = fake_payload(&dir);
        assert!(p.node.is_file() && p.entry.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_relative_root_becomes_absolute_so_the_child_can_find_its_node() {
        let relative = PathBuf::from(format!("payload-relative-test-{}", std::process::id()));
        let absolute = std::env::current_dir().unwrap().join(&relative);
        let _ = fs::remove_dir_all(&absolute);
        fake_payload(&absolute);
        let payload = Payload::at(&relative).unwrap();
        assert!(payload.root.is_absolute() && payload.node.is_absolute() && payload.entry.is_absolute());
        assert_eq!(payload.root, absolute);
        fs::remove_dir_all(absolute).unwrap();
    }

    #[test]
    fn a_missing_node_or_entry_names_the_path_and_nothing_falls_back() {
        let dir = tempdir("missing");
        let p = fake_payload(&dir);
        fs::remove_file(&p.node).unwrap();
        assert_eq!(Payload::at(&dir).unwrap_err().missing, p.node);
        fs::write(&p.node, "").unwrap();
        fs::remove_file(&p.entry).unwrap();
        assert_eq!(Payload::at(&dir).unwrap_err().missing, p.entry);
        // A folder where the file should be is not the file.
        fs::create_dir_all(&p.entry).unwrap();
        assert_eq!(Payload::at(&dir).unwrap_err().missing, p.entry);
        fs::remove_dir_all(dir).unwrap();
    }
}
