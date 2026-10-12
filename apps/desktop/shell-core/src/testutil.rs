//! Helpers shared by the unit tests of this crate.
use crate::Payload;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mordomo-shell-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A payload whose Node binary and entry file exist and are empty (enough for `Payload::at`).
pub(crate) fn fake_payload(dir: &Path) -> Payload {
    let node = if cfg!(windows) {
        dir.join("runtime").join("node.exe")
    } else {
        dir.join("runtime").join("bin").join("node")
    };
    fs::create_dir_all(node.parent().unwrap()).unwrap();
    fs::create_dir_all(dir.join("lib")).unwrap();
    fs::write(&node, "").unwrap();
    fs::write(dir.join("lib").join("mordomo.mjs"), "").unwrap();
    Payload::at(dir).unwrap()
}
