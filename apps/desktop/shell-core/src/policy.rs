use crate::ready::Ready;

/// Whether the app asks the update endpoint by itself when it opens: only in a build that has an updater, and only when
/// the owner turned `updates.check` on (the service says so in its ready line). The menu's "Check for Updates" is the
/// owner asking, and needs neither: it is always there in a build that has an updater.
pub fn check_for_update_at_start(updater_built: bool, ready: &Ready) -> bool {
    updater_built && ready.updates_check
}

/// Replace the app's files with the service stopped (on Windows the installer cannot replace files that the running
/// service holds), and bring the service back when the install fails: the files are then still the old ones, and the
/// window would otherwise keep showing the Command Centre over a dead service. When `install` succeeds the app restarts
/// (or, on Windows, the installer ends this process), so there is nothing to bring back.
pub fn install_with_service_stopped<E>(
    stop: impl FnOnce(),
    install: impl FnOnce() -> Result<(), E>,
    bring_back: impl FnOnce(),
) -> Result<(), E> {
    stop();
    let result = install();
    if result.is_err() {
        bring_back();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn ready(updates_check: bool) -> Ready {
        Ready {
            v: 1,
            pid: 1,
            port: 4000,
            version: "0.8.0".into(),
            updates_check,
        }
    }

    #[test]
    fn only_a_build_with_an_updater_and_the_owners_setting_asks_at_start() {
        assert!(check_for_update_at_start(true, &ready(true)));
        assert!(!check_for_update_at_start(true, &ready(false)));
        assert!(!check_for_update_at_start(false, &ready(true)));
        assert!(!check_for_update_at_start(false, &ready(false)));
    }

    #[test]
    fn the_service_is_stopped_before_the_install_and_comes_back_only_when_the_install_fails() {
        let calls = RefCell::new(Vec::new());
        let ok: Result<(), String> = install_with_service_stopped(
            || calls.borrow_mut().push("stop"),
            || {
                calls.borrow_mut().push("install");
                Ok(())
            },
            || calls.borrow_mut().push("bring back"),
        );
        assert_eq!(ok, Ok(()));
        assert_eq!(*calls.borrow(), ["stop", "install"]);

        calls.borrow_mut().clear();
        let failed = install_with_service_stopped(
            || calls.borrow_mut().push("stop"),
            || {
                calls.borrow_mut().push("install");
                Err("the installer refused the package")
            },
            || calls.borrow_mut().push("bring back"),
        );
        assert_eq!(failed, Err("the installer refused the package"));
        assert_eq!(*calls.borrow(), ["stop", "install", "bring back"]);
    }
}
