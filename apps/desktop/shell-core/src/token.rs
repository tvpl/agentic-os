use std::fmt;

/// The secret one launch of the shell hands to the service it starts (and to nothing else): 32 bytes from the
/// operating system's generator, written as 43 URL-safe base64 characters without padding.
#[derive(Clone, PartialEq, Eq)]
pub struct LaunchToken(String);

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

impl LaunchToken {
    pub fn generate() -> Result<Self, getrandom::Error> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes)?;
        Ok(Self::from_bytes(&bytes))
    }

    /// The token for given bytes (the generator's output, or a fixed value in a test).
    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        let mut out = String::with_capacity(43);
        for chunk in bytes.chunks(3) {
            let n = chunk.iter().fold(0u32, |acc, b| (acc << 8) | u32::from(*b)) << (8 * (3 - chunk.len()));
            // 3 bytes -> 4 characters; a final chunk of 2 -> 3, of 1 -> 2 (no padding).
            for i in 0..(chunk.len() + 1) {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 0x3f) as usize] as char);
            }
        }
        Self(out)
    }

    /// The secret itself: for the environment of the service and the first address of the window, nowhere else.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for LaunchToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LaunchToken(<redacted>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_43_url_safe_characters() {
        let t = LaunchToken::generate().unwrap();
        assert_eq!(t.expose().len(), 43);
        assert!(t
            .expose()
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
    }

    #[test]
    fn two_tokens_differ() {
        assert_ne!(LaunchToken::generate().unwrap(), LaunchToken::generate().unwrap());
    }

    #[test]
    fn debug_never_prints_the_secret() {
        let t = LaunchToken::generate().unwrap();
        let shown = format!("{t:?} {:#?}", t);
        assert!(!shown.contains(t.expose()));
        assert!(shown.contains("redacted"));
    }

    #[test]
    fn the_encoding_is_base64url_without_padding() {
        // 32 zero bytes are 'A' x 43; 32 bytes of ones are '_' x 42 and '8' (the last 2 bytes give 3 characters).
        assert_eq!(LaunchToken::from_bytes(&[0u8; 32]).expose(), "A".repeat(43));
        let ones = LaunchToken::from_bytes(&[0xffu8; 32]);
        assert_eq!(ones.expose(), format!("{}8", "_".repeat(42)));
        let mut bytes = [0u8; 32];
        bytes[0] = 0xfb; // 111110 11.. -> '-' then bits of the next byte
        assert!(LaunchToken::from_bytes(&bytes).expose().starts_with("-w"));
    }
}
