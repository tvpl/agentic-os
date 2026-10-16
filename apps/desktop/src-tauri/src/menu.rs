//! The native menu: the one a person expects (About, Edit with copy and paste, Window), with "Check for Updates" in a
//! build that has an updater. English, like the operating system's own menus; the screens speak English and Portuguese.

use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{App, Manager};

const RELOAD: &str = "reload";
#[cfg(feature = "updater")]
const CHECK_FOR_UPDATES: &str = "check-for-updates";

pub fn install(app: &mut App) -> tauri::Result<()> {
    let about = AboutMetadataBuilder::new()
        .name(Some("MordomoOS"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .license(Some("Functional Source License 1.1 (Apache-2.0 future license)"))
        .comments(Some(if cfg!(feature = "updater") {
            "Local agentic OS over Claude Code, Cursor Agent and Codex."
        } else {
            "Local agentic OS over Claude Code, Cursor Agent and Codex. This build has no updater."
        }))
        .build();

    // `mut` is used only by the macOS and updater additions below.
    #[allow(unused_mut)]
    let mut application = SubmenuBuilder::new(app, "MordomoOS").about(Some(about));
    #[cfg(feature = "updater")]
    {
        let check = MenuItemBuilder::with_id(CHECK_FOR_UPDATES, "Check for Updates…").build(app)?;
        application = application.separator().item(&check);
    }
    #[cfg(target_os = "macos")]
    {
        application = application
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all();
    }
    let application = application.separator().quit().build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let reload = MenuItemBuilder::with_id(RELOAD, "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    #[allow(unused_mut)]
    let mut view = SubmenuBuilder::new(app, "View").item(&reload);
    #[cfg(target_os = "macos")]
    {
        view = view.separator().fullscreen();
    }
    let view = view.build()?;

    #[allow(unused_mut)]
    let mut window = SubmenuBuilder::new(app, "Window").minimize();
    #[cfg(not(target_os = "macos"))]
    {
        window = window.maximize();
    }
    let window = window.close_window().build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&application, &edit, &view, &window])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        RELOAD => {
            if let Some(window) = app.get_webview_window(crate::shell::MAIN_WINDOW) {
                let _ = window.eval("window.location.reload()");
            }
        }
        #[cfg(feature = "updater")]
        CHECK_FOR_UPDATES => crate::updater::check_interactive(app),
        _ => {}
    });
    Ok(())
}
