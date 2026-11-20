//! Subresource-integrity strings (`sha512-<base64>`), the form npm and the
//! extension index use to pin a tarball.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use sha2::{Digest, Sha512};

use crate::error::IntegrityError;

const PREFIX: &str = "sha512-";
const DIGEST_LEN: usize = 64;

/// The `sha512-<base64>` SRI string of `bytes`.
pub fn sha512_sri(bytes: &[u8]) -> String {
    format!("{PREFIX}{}", STANDARD.encode(Sha512::digest(bytes)))
}

/// Decodes a `sha512-<base64>` string to its 64-byte digest. Only sha512 is
/// accepted: weaker algorithms npm still prints for old packages would let a
/// collision through, and an index has no reason to use them.
pub fn parse_sri(sri: &str) -> Result<Vec<u8>, IntegrityError> {
    let encoded = sri
        .strip_prefix(PREFIX)
        .ok_or_else(|| IntegrityError::Malformed(sri.to_string()))?;
    let digest = STANDARD
        .decode(encoded)
        .map_err(|_| IntegrityError::Malformed(sri.to_string()))?;
    if digest.len() != DIGEST_LEN {
        return Err(IntegrityError::Malformed(sri.to_string()));
    }
    Ok(digest)
}

/// Whether `sri` is a well-formed sha512 SRI string.
pub fn is_sri(sri: &str) -> bool {
    parse_sri(sri).is_ok()
}

/// Checks `bytes` against `expected_sri`.
pub fn verify(bytes: &[u8], expected_sri: &str) -> Result<(), IntegrityError> {
    let expected = parse_sri(expected_sri)?;
    let actual = Sha512::digest(bytes);
    if actual.as_slice() == expected.as_slice() {
        Ok(())
    } else {
        Err(IntegrityError::Mismatch {
            expected: expected_sri.to_string(),
            actual: sha512_sri(bytes),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_detects_a_mismatch() {
        let sri = sha512_sri(b"hello");
        assert!(sri.starts_with("sha512-"));
        assert!(verify(b"hello", &sri).is_ok());
        assert!(matches!(
            verify(b"hellO", &sri),
            Err(IntegrityError::Mismatch { .. })
        ));
    }

    #[test]
    fn matches_the_known_digest() {
        // `printf '' | openssl dgst -sha512 -binary | base64`
        assert_eq!(
            sha512_sri(b""),
            "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg=="
        );
    }

    #[test]
    fn rejects_malformed_and_weaker_hashes() {
        for bad in [
            "",
            "sha512-",
            "sha512-!!!",
            "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
            "sha512-AAAA",
        ] {
            assert!(
                matches!(verify(b"", bad), Err(IntegrityError::Malformed(_))),
                "{bad}"
            );
        }
    }
}
