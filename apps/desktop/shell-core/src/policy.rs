use crate::ready::Ready;

/// Whether the app asks the update endpoint by itself when it opens: only in a build that has an updater, and only when
/// the owner turned `updates.check` on (the service says so in its ready line). The menu's "Check for Updates" is the
/// owner asking, and needs neither: it is always there in a build that has an updater.
pub fn check_for_update_at_start(updater_built: bool, ready: &Ready) -> bool {
    updater_built && ready.updates_check
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
