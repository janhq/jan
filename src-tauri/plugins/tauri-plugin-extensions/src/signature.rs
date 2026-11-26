//! Detached ed25519 signatures of index documents.
//!
//! Jan ships no key: the trust anchor of a source is the public key the
//! user pinned when adding it. A keyed source publishes `<index url>.sig`
//! next to its index: the standard base64 (with padding) of the 64-byte
//! ed25519 signature over the exact index bytes, optionally followed by
//! whitespace such as a trailing newline. The signature is checked with
//! `verify_strict`, which also refuses weak (small-order) keys and
//! non-canonical signatures, before a single byte of the index is parsed.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey, PUBLIC_KEY_LENGTH, SIGNATURE_LENGTH};
use url::Url;

use crate::error::SignatureError;

/// Appended to the index URL's path to name its signature.
pub const SIGNATURE_SUFFIX: &str = ".sig";
/// Largest signature file. A signature is 88 base64 characters; anything
/// much bigger is not one and is not read further.
pub const MAX_SIGNATURE_BYTES: usize = 1024;

/// Decodes a pinned public key: standard base64 of 32 bytes that is a
/// valid, non-weak curve point.
pub fn parse_public_key(key: &str) -> Result<VerifyingKey, SignatureError> {
    let bytes = STANDARD
        .decode(key.trim())
        .map_err(|_| SignatureError::MalformedKey)?;
    let bytes: [u8; PUBLIC_KEY_LENGTH] = bytes.try_into().map_err(|_| SignatureError::MalformedKey)?;
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| SignatureError::MalformedKey)?;
    if key.is_weak() {
        return Err(SignatureError::MalformedKey);
    }
    Ok(key)
}

/// Whether `key` is acceptable as a pinned key.
pub fn is_public_key(key: &str) -> bool {
    parse_public_key(key).is_ok()
}

/// Decodes the contents of a `.sig` file.
pub fn parse_signature(text: &[u8]) -> Result<Signature, SignatureError> {
    let text = std::str::from_utf8(text).map_err(|_| SignatureError::Malformed)?;
    let bytes = STANDARD
        .decode(text.trim())
        .map_err(|_| SignatureError::Malformed)?;
    let bytes: [u8; SIGNATURE_LENGTH] = bytes.try_into().map_err(|_| SignatureError::Malformed)?;
    Ok(Signature::from_bytes(&bytes))
}

/// Checks the `.sig` contents `signature` over the exact `index` bytes
/// against the pinned base64 `public_key`.
pub fn verify_index(index: &[u8], signature: &[u8], public_key: &str) -> Result<(), SignatureError> {
    let key = parse_public_key(public_key)?;
    let signature = parse_signature(signature)?;
    key.verify_strict(index, &signature)
        .map_err(|_| SignatureError::Mismatch)
}

/// The URL of the signature of the index at `index_url`: the same URL
/// with [`SIGNATURE_SUFFIX`] appended to its path. The query is kept and a
/// fragment (never sent anyway) is dropped.
pub fn signature_url(index_url: &Url) -> Url {
    let mut url = index_url.clone();
    let path = format!("{}{SIGNATURE_SUFFIX}", url.path());
    url.set_path(&path);
    url.set_fragment(None);
    url
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// A fixed test keypair: never use outside tests.
    pub(crate) fn signing_key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    pub(crate) fn public_key(key: &SigningKey) -> String {
        STANDARD.encode(key.verifying_key().to_bytes())
    }

    pub(crate) fn sign(key: &SigningKey, bytes: &[u8]) -> Vec<u8> {
        format!("{}\n", STANDARD.encode(key.sign(bytes).to_bytes())).into_bytes()
    }

    // RFC 8032 section 7.1, TEST 2: a known-good vector, independent of
    // this crate's signing code.
    const RFC_KEY: &str = "PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=";
    const RFC_MESSAGE: &[u8] = &[0x72];
    const RFC_SIGNATURE: &str =
        "kqAJqfDUyrhyDoILX2QlQKKye1QWUD+Ps3YiI+vbadoIWsHkPhWZbkWPNhPQ8R2MOHsurrQwKu6wDSkWErsMAA==";

    #[test]
    fn accepts_the_rfc_8032_vector() {
        verify_index(RFC_MESSAGE, RFC_SIGNATURE.as_bytes(), RFC_KEY).unwrap();
        // Surrounding whitespace, e.g. a trailing newline, is fine.
        verify_index(RFC_MESSAGE, format!(" {RFC_SIGNATURE}\r\n").as_bytes(), RFC_KEY).unwrap();
    }

    #[test]
    fn accepts_a_good_signature_over_index_bytes() {
        let key = signing_key(7);
        let index = br#"{"schema":1,"generatedAt":"x","extensions":[]}"#;
        verify_index(index, &sign(&key, index), &public_key(&key)).unwrap();
    }

    #[test]
    fn a_tampered_index_byte_is_rejected() {
        let key = signing_key(7);
        let index = br#"{"schema":1,"generatedAt":"x","extensions":[]}"#.to_vec();
        let signature = sign(&key, &index);
        for at in [0, index.len() / 2, index.len() - 1] {
            let mut tampered = index.clone();
            tampered[at] ^= 0x01;
            assert_eq!(
                verify_index(&tampered, &signature, &public_key(&key)),
                Err(SignatureError::Mismatch),
                "byte {at}"
            );
        }
        let mut longer = index.clone();
        longer.push(b' ');
        assert_eq!(verify_index(&longer, &signature, &public_key(&key)), Err(SignatureError::Mismatch));
        assert_eq!(verify_index(RFC_MESSAGE, RFC_SIGNATURE.as_bytes(), &public_key(&key)), Err(SignatureError::Mismatch));
    }

    #[test]
    fn a_signature_by_another_key_is_rejected() {
        let index = b"index bytes";
        let signature = sign(&signing_key(8), index);
        assert_eq!(
            verify_index(index, &signature, &public_key(&signing_key(7))),
            Err(SignatureError::Mismatch)
        );
    }

    #[test]
    fn a_truncated_or_non_base64_signature_is_rejected() {
        let key = signing_key(7);
        let index = b"index bytes";
        let good = String::from_utf8(sign(&key, index)).unwrap();
        let good = good.trim();
        let short = STANDARD.encode(&STANDARD.decode(good).unwrap()[..63]);
        let long = STANDARD.encode([STANDARD.decode(good).unwrap(), vec![0]].concat());
        let unpadded = good.trim_end_matches('=');
        for bad in [
            "",
            "\n",
            &good[..good.len() - 4],
            unpadded,
            &short,
            &long,
            "not base64 at all!",
            &format!("{good} {good}"),
        ] {
            assert_eq!(
                verify_index(index, bad.as_bytes(), &public_key(&key)),
                Err(SignatureError::Malformed),
                "{bad:?}"
            );
        }
        assert_eq!(verify_index(index, &[0xff, 0xfe], &public_key(&key)), Err(SignatureError::Malformed));
    }

    #[test]
    fn bad_or_weak_keys_are_refused() {
        for key in [
            "",
            "AAAA",
            "not base64!",
            // 32 zero bytes: a small-order point.
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            // The identity point, also weak.
            "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        ] {
            assert!(!is_public_key(key), "{key:?}");
            assert_eq!(verify_index(RFC_MESSAGE, RFC_SIGNATURE.as_bytes(), key), Err(SignatureError::MalformedKey));
        }
        assert!(is_public_key(RFC_KEY));
    }

    #[test]
    fn the_signature_sits_next_to_the_index() {
        let url = |u: &str| signature_url(&Url::parse(u).unwrap()).to_string();
        assert_eq!(url("https://ext.example.com/index.json"), "https://ext.example.com/index.json.sig");
        assert_eq!(url("https://ext.example.com/a/index.json?v=2#top"), "https://ext.example.com/a/index.json.sig?v=2");
        assert_eq!(url("https://ext.example.com"), "https://ext.example.com/.sig");
    }
}
