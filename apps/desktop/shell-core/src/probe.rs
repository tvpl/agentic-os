use std::fmt;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeError {
    /// Nothing answered (refused, reset, timed out): the text is the operating system's.
    Io(String),
    /// Something answered, but not `200`.
    Status(u16),
    /// Something answered `200` and it is not an HTML page: the Command Centre is not what is being served.
    NotHtml(String),
    /// The answer is not HTTP.
    NotHttp,
}

impl fmt::Display for ProbeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProbeError::Io(e) => write!(f, "the service does not answer: {e}"),
            ProbeError::Status(s) => write!(f, "the service answered {s} instead of 200"),
            ProbeError::NotHtml(t) => {
                write!(f, "the service answered {t:?} instead of the Command Centre page")
            }
            ProbeError::NotHttp => write!(f, "the service did not answer in HTTP"),
        }
    }
}

/// `GET /` on `127.0.0.1:<port>`: `200` and `text/html`, which is what the Command Centre's page is. Raw HTTP/1.1 over
/// a loopback socket, no client library: nothing but this machine can be reached from here, by construction.
pub fn probe_ui(port: u16, timeout: Duration) -> Result<(), ProbeError> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout).map_err(|e| ProbeError::Io(e.to_string()))?;
    let io = |e: std::io::Error| ProbeError::Io(e.to_string());
    stream.set_read_timeout(Some(timeout)).map_err(io)?;
    stream.set_write_timeout(Some(timeout)).map_err(io)?;
    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/html\r\nUser-Agent: mordomo-desktop\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(io)?;
    // The status line and the headers fit in 8 KiB; the page itself is not needed.
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while head.len() < 8192 && !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut chunk).map_err(io)?;
        if n == 0 {
            break;
        }
        head.extend_from_slice(&chunk[..n]);
    }
    parse_head(&String::from_utf8_lossy(&head))
}

fn parse_head(head: &str) -> Result<(), ProbeError> {
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let mut parts = status_line.split(' ');
    if !parts.next().is_some_and(|v| v.starts_with("HTTP/1.")) {
        return Err(ProbeError::NotHttp);
    }
    let status: u16 = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or(ProbeError::NotHttp)?;
    if status != 200 {
        return Err(ProbeError::Status(status));
    }
    let content_type = lines
        .take_while(|l| !l.is_empty())
        .find_map(|l| {
            let (name, value) = l.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-type")
                .then(|| value.trim().to_string())
        })
        .unwrap_or_default();
    if content_type.to_ascii_lowercase().starts_with("text/html") {
        Ok(())
    } else {
        Err(ProbeError::NotHtml(content_type))
    }
}

/// Probe until the page answers, `alive` says the service is gone, or `deadline` passes. The last error is returned.
pub fn wait_for_ui(port: u16, deadline: Instant, mut alive: impl FnMut() -> bool) -> Result<(), ProbeError> {
    loop {
        let err = match probe_ui(port, Duration::from_secs(2)) {
            Ok(()) => return Ok(()),
            Err(e) => e,
        };
        if !alive() || Instant::now() >= deadline {
            return Err(err);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// A one-shot server on a free loopback port that answers `reply` to the first connection.
    fn serve_once(reply: &'static str) -> u16 {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let n = s.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                assert!(request.starts_with("GET / HTTP/1.1\r\n"), "{request}");
                assert!(
                    request.contains(&format!("Host: 127.0.0.1:{port}\r\n")),
                    "{request}"
                );
                let _ = s.write_all(reply.as_bytes());
            }
        });
        port
    }

    #[test]
    fn a_200_html_page_is_the_command_centre() {
        let port =
            serve_once("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!doctype html>");
        assert_eq!(probe_ui(port, Duration::from_secs(2)), Ok(()));
        let port = serve_once("HTTP/1.1 200 OK\r\ncontent-type: TEXT/HTML\r\n\r\n");
        assert_eq!(probe_ui(port, Duration::from_secs(2)), Ok(()));
    }

    #[test]
    fn anything_else_is_named() {
        let port = serve_once("HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html\r\n\r\n");
        assert_eq!(
            probe_ui(port, Duration::from_secs(2)),
            Err(ProbeError::Status(503))
        );
        let port = serve_once("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}");
        assert_eq!(
            probe_ui(port, Duration::from_secs(2)),
            Err(ProbeError::NotHtml("application/json".into()))
        );
        let port = serve_once("HTTP/1.1 200 OK\r\n\r\n");
        assert_eq!(
            probe_ui(port, Duration::from_secs(2)),
            Err(ProbeError::NotHtml(String::new()))
        );
        let port = serve_once("SSH-2.0-OpenSSH_9.6\r\n");
        assert_eq!(probe_ui(port, Duration::from_secs(2)), Err(ProbeError::NotHttp));
    }

    #[test]
    fn a_closed_port_is_an_io_error_and_the_wait_stops_when_the_service_is_gone() {
        let port = {
            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            l.local_addr().unwrap().port()
        };
        assert!(matches!(
            probe_ui(port, Duration::from_millis(500)),
            Err(ProbeError::Io(_))
        ));
        let started = Instant::now();
        let far = Instant::now() + Duration::from_secs(60);
        assert!(matches!(wait_for_ui(port, far, || false), Err(ProbeError::Io(_))));
        assert!(started.elapsed() < Duration::from_secs(5));
        let near = Instant::now() + Duration::from_millis(300);
        assert!(matches!(wait_for_ui(port, near, || true), Err(ProbeError::Io(_))));
    }
}
