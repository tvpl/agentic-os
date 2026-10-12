fn main() {
    // The window may call exactly these app commands, through capabilities/main.json (`allow-<command>` each),
    // and no plugin command at all.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["shell_status", "shell_retry", "shell_quit"]),
    ))
    .expect("failed to run the Tauri build script");
}
