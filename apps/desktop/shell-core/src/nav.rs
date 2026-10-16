use url::{Host, Url};

/// What the window does with an address it is asked to load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavAction {
    /// Load it in the window.
    Allow,
    /// Hand it to the system browser; the window stays where it is.
    OpenExternally,
    /// Do nothing.
    Deny,
}

/// The window loads its own assets and the service's origin (`http://127.0.0.1:<sidecar_port>`) and nothing else.
/// A plain web address that is neither goes to the system browser; every other scheme (`javascript:`, `file:`, `data:`,
/// `blob:`, `ftp:`, a custom one) is refused. `sidecar_port` is `None` until the service said where it listens.
pub fn decide(address: &str, sidecar_port: Option<u16>) -> NavAction {
    let Ok(url) = Url::parse(address) else {
        return NavAction::Deny;
    };
    let plain_credentials = url.username().is_empty() && url.password().is_none();
    match url.scheme() {
        // The window's own assets: `tauri://localhost` on macOS and Linux, `http(s)://tauri.localhost` on Windows.
        "tauri" if matches!(url.host(), Some(Host::Domain("localhost"))) && plain_credentials => {
            NavAction::Allow
        }
        "http" | "https"
            if matches!(url.host(), Some(Host::Domain("tauri.localhost")))
                && url.port().is_none()
                && plain_credentials =>
        {
            NavAction::Allow
        }
        "http"
            if sidecar_port.is_some_and(|p| {
                matches!(url.host(), Some(Host::Ipv4(ip)) if ip.octets() == [127, 0, 0, 1])
                    && url.port() == Some(p)
            }) && plain_credentials =>
        {
            NavAction::Allow
        }
        "about" if url.as_str() == "about:blank" => NavAction::Allow,
        "http" | "https" | "mailto" => NavAction::OpenExternally,
        _ => NavAction::Deny,
    }
}

/// What the shell does about one request, as the two things it can do: load the address in the window, or hand it to the
/// system. Never both; for anything `decide` does not allow, never the first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Handling {
    /// The webview goes on to load the address (the answer of the navigation handler).
    pub load_in_window: bool,
    /// The address is opened by the system (browser or mail client) instead.
    pub open_in_system: bool,
}

/// The window itself is navigating to `address` (a click, a redirect, a script). Only `Allow` loads; an address of
/// another origin is never loaded in the window, it goes to the system browser.
pub fn on_navigation(address: &str, sidecar_port: Option<u16>) -> Handling {
    match decide(address, sidecar_port) {
        NavAction::Allow => Handling {
            load_in_window: true,
            open_in_system: false,
        },
        NavAction::OpenExternally => Handling {
            load_in_window: false,
            open_in_system: true,
        },
        NavAction::Deny => Handling {
            load_in_window: false,
            open_in_system: false,
        },
    }
}

/// A page asked for a new window (`window.open`, `target=_blank`). No second webview is ever created, so nothing loads
/// in a window; what the policy allows or sends out is shown by the system browser, the rest is dropped.
pub fn on_new_window(address: &str, sidecar_port: Option<u16>) -> Handling {
    Handling {
        load_in_window: false,
        open_in_system: decide(address, sidecar_port) != NavAction::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use NavAction::*;

    const PORT: Option<u16> = Some(41234);

    #[test]
    fn the_window_loads_its_own_assets_and_the_services_origin() {
        for address in [
            "tauri://localhost/index.html",
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "http://127.0.0.1:41234/",
            "http://127.0.0.1:41234/?launch=abc",
            "http://127.0.0.1:41234/settings#x",
            "about:blank",
        ] {
            assert_eq!(decide(address, PORT), Allow, "{address}");
        }
    }

    #[test]
    fn the_services_origin_needs_the_exact_port_the_service_said() {
        assert_eq!(decide("http://127.0.0.1:41234/", None), OpenExternally);
        assert_eq!(decide("http://127.0.0.1:41235/", PORT), OpenExternally);
        assert_eq!(decide("http://127.0.0.1/", PORT), OpenExternally);
        assert_eq!(decide("http://localhost:41234/", PORT), OpenExternally);
        assert_eq!(decide("http://[::1]:41234/", PORT), OpenExternally);
        assert_eq!(decide("https://127.0.0.1:41234/", PORT), OpenExternally);
    }

    #[test]
    fn look_alikes_and_userinfo_do_not_pass_for_the_origin() {
        for address in [
            "http://127.0.0.1.evil.example:41234/",
            // userinfo: the host is evil.example, `127.0.0.1:41234` is the user name and password
            "http://127.0.0.1:41234@evil.example/",
            "http://user:pw@127.0.0.1:41234/",
            "http://evil.example/?next=http://127.0.0.1:41234/",
            "http://tauri.localhost.evil.example/",
            "http://tauri.localhost:8080/",
            "tauri://evil/",
            "tauri://localhost@evil/",
        ] {
            assert_ne!(decide(address, PORT), Allow, "{address}");
        }
    }

    #[test]
    fn web_and_mail_addresses_go_to_the_system_browser() {
        for address in [
            "https://github.com/tvpl/agentic-os",
            "http://example.com/a?b=c",
            "mailto:dono@example.com",
        ] {
            assert_eq!(decide(address, PORT), OpenExternally, "{address}");
        }
    }

    #[test]
    fn every_other_scheme_and_anything_unreadable_is_refused() {
        for address in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<script>1</script>",
            "blob:http://127.0.0.1:41234/uuid",
            "ftp://example.com/",
            "ssh://example.com/",
            "vscode://file/x",
            "view-source:http://127.0.0.1:41234/",
            "about:srcdoc",
            "tauri-evil://localhost/",
            "",
            "not a url",
            "//evil.example/",
        ] {
            assert_eq!(decide(address, PORT), Deny, "{address:?}");
        }
    }

    fn handling(load_in_window: bool, open_in_system: bool) -> Handling {
        Handling {
            load_in_window,
            open_in_system,
        }
    }

    #[test]
    fn the_window_never_loads_an_address_of_another_origin_it_hands_it_to_the_system() {
        for address in [
            "https://github.com/tvpl/agentic-os",
            "http://example.com/",
            "http://127.0.0.1:41235/",
            "http://127.0.0.1.evil.example:41234/",
            "http://localhost:41234/",
            "mailto:dono@example.com",
        ] {
            assert_eq!(on_navigation(address, PORT), handling(false, true), "{address}");
        }
        // before the service said where it listens, even its own address is another origin
        assert_eq!(
            on_navigation("http://127.0.0.1:41234/", None),
            handling(false, true)
        );
    }

    #[test]
    fn the_window_loads_only_what_is_allowed_and_nothing_else_reaches_the_system() {
        for address in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "http://127.0.0.1:41234/?launch=abc",
            "about:blank",
        ] {
            assert_eq!(on_navigation(address, PORT), handling(true, false), "{address}");
        }
        for address in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "blob:http://127.0.0.1:41234/u",
            "",
        ] {
            assert_eq!(
                on_navigation(address, PORT),
                handling(false, false),
                "{address:?}"
            );
        }
    }

    #[test]
    fn a_new_window_is_never_made_what_is_allowed_or_sent_out_opens_in_the_system() {
        for address in [
            "http://127.0.0.1:41234/artifact/1",
            "https://github.com/tvpl/agentic-os",
            "mailto:dono@example.com",
        ] {
            assert_eq!(on_new_window(address, PORT), handling(false, true), "{address}");
        }
        for address in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "not a url",
        ] {
            assert_eq!(
                on_new_window(address, PORT),
                handling(false, false),
                "{address:?}"
            );
        }
    }
}
