//! Error types of the pure modules and of the command surface.

use std::fmt;
use std::path::PathBuf;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Why a tarball was refused or could not be extracted.
#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    /// Reading the archive or writing the extracted files failed.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// More decompressed bytes than `Limits::max_total_bytes`.
    #[error("the package expands to more than {limit} bytes")]
    TooLarge {
        /// The cap that was exceeded.
        limit: u64,
    },
    /// More entries than `Limits::max_entries`.
    #[error("the package has more than {limit} entries")]
    TooManyEntries {
        /// The cap that was exceeded.
        limit: usize,
    },
    /// More distinct directories than `Limits::max_dirs`.
    #[error("the package has more than {limit} directories")]
    TooManyDirectories {
        /// The cap that was exceeded.
        limit: usize,
    },
    /// One file is larger than `Limits::max_file_bytes`.
    #[error("'{path}' is larger than {limit} bytes")]
    FileTooLarge {
        /// The offending entry, as written in the archive.
        path: String,
        /// The cap that was exceeded.
        limit: u64,
    },
    /// An entry type other than a regular file or a directory.
    #[error("'{path}' is a {kind}, only regular files and directories are allowed")]
    UnsupportedEntry {
        /// The offending entry.
        path: String,
        /// A readable name of its type.
        kind: String,
    },
    /// A path nested deeper or longer than `Limits` allows.
    #[error("'{path}' is nested deeper than {max_depth} levels or longer than {max_bytes} bytes")]
    PathTooLong {
        /// The offending entry, lossily decoded.
        path: String,
        /// The depth cap.
        max_depth: usize,
        /// The length cap.
        max_bytes: usize,
    },
    /// A path that is not `package/` followed by plain relative components.
    #[error("'{path}' is not a safe path inside package/")]
    UnsafePath {
        /// The offending entry, lossily decoded.
        path: String,
    },
    /// The same path twice, possibly differing only in letter case.
    #[error("'{path}' appears more than once (paths are compared case-insensitively)")]
    Duplicate {
        /// The second occurrence.
        path: String,
    },
    /// `package/package.json` is missing.
    #[error("the package has no package/package.json")]
    MissingPackageJson,
    /// `package/package.json` is not a JSON object.
    #[error("package/package.json is not valid JSON: {0}")]
    BadPackageJson(String),
    /// The destination directory already exists.
    #[error("the extraction target {0} already exists")]
    DestinationExists(PathBuf),
}

/// A failed `sha512-<base64>` check.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum IntegrityError {
    /// Not a `sha512-` SRI string with a 64-byte digest.
    #[error("'{0}' is not a sha512 integrity string")]
    Malformed(String),
    /// The bytes hash to something else.
    #[error("integrity mismatch: expected {expected}, got {actual}")]
    Mismatch {
        /// The pinned value.
        expected: String,
        /// What the bytes hash to.
        actual: String,
    },
}

/// Why the signature of an index from a keyed source was refused. Any of
/// these rejects the whole index before it is parsed.
#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum SignatureError {
    /// The pinned key is not base64 of a valid, non-weak ed25519 key.
    #[error("the pinned public key is not a valid ed25519 key")]
    MalformedKey,
    /// The source has a pinned key but its `.sig` could not be fetched.
    #[error("the source has a pinned key, but its index signature is missing: {0}")]
    Missing(String),
    /// The `.sig` is not standard base64 of 64 bytes.
    #[error("the index signature is not base64 of a 64-byte ed25519 signature")]
    Malformed,
    /// The signature does not verify over the index bytes with the key.
    #[error("the index signature does not match the source's pinned key")]
    Mismatch,
    /// A validly signed index older than one already accepted from the
    /// source: an old index served again (a rollback or a freeze).
    #[error("the signed index was generated at {generated_at}, before the index already accepted from this source ({last}); an old index may be being replayed")]
    Rollback {
        /// The `generatedAt` of the refused index.
        generated_at: String,
        /// The newest `generatedAt` accepted before.
        last: String,
    },
    /// A validly signed index past its signed `expires` time.
    #[error("the signed index expired at {0}; the source must publish a fresh one")]
    Expired(String),
    /// A validly signed index generated further ahead of this clock than
    /// skew explains. Accepted, it would become the rollback mark and lock
    /// the source out of every honest index after it.
    #[error("the signed index claims to be generated at {0}, in the future; check this computer's clock or the source's")]
    FromTheFuture(String),
    /// A signed index whose `generatedAt` or `expires` is not an RFC 3339
    /// time, so its freshness cannot be checked.
    #[error("the signed index has no valid RFC 3339 {0}")]
    BadTimestamp(&'static str),
}

/// One manifest problem, with the same path syntax as the TypeScript
/// validator (`jan.contributes.commands[1].id`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ManifestIssue {
    /// Where the problem is.
    pub path: String,
    /// What is wrong.
    pub message: String,
}

/// Every problem found in a manifest.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub struct ManifestErrors(pub Vec<ManifestIssue>);

impl fmt::Display for ManifestErrors {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let parts: Vec<String> = self
            .0
            .iter()
            .map(|issue| {
                if issue.path.is_empty() {
                    issue.message.clone()
                } else {
                    format!("{} {}", issue.path, issue.message)
                }
            })
            .collect();
        write!(f, "invalid manifest: {}", parts.join("; "))
    }
}

/// Reading or writing `extensions.json` / `sources.json` failed.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// File system error.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// Serializing failed.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// What a command can fail with. Serialized to the webview as
/// `{ kind, message }` so the UI can branch on `kind` and show `message`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// See [`BundleError`].
    #[error(transparent)]
    Bundle(#[from] BundleError),
    /// See [`IntegrityError`].
    #[error(transparent)]
    Integrity(#[from] IntegrityError),
    /// See [`SignatureError`].
    #[error(transparent)]
    Signature(#[from] SignatureError),
    /// See [`ManifestErrors`].
    #[error(transparent)]
    Manifest(#[from] ManifestErrors),
    /// See [`StoreError`].
    #[error(transparent)]
    Store(#[from] StoreError),
    /// File system error outside extraction.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// No such extension, stage, source or version.
    #[error("{0}")]
    NotFound(String),
    /// The request is not allowed (grants, safe mode, disabled, downgrade).
    #[error("{0}")]
    Denied(String),
    /// The arguments are malformed.
    #[error("{0}")]
    Invalid(String),
    /// Installed files no longer match what was recorded at install time.
    #[error("{0}")]
    Tampered(String),
    /// A network request failed.
    #[error("{0}")]
    Network(String),
    /// A response or request body is over its cap.
    #[error("{0}")]
    TooLarge(String),
    /// The caller cancelled the request.
    #[error("the request was cancelled")]
    Cancelled,
}

impl Error {
    /// The stable machine-readable kind sent to the webview.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Bundle(_) => "bundle",
            Error::Integrity(_) => "integrity",
            Error::Signature(_) => "signature",
            Error::Manifest(_) => "manifest",
            Error::Store(_) | Error::Io(_) => "io",
            Error::NotFound(_) => "notFound",
            Error::Denied(_) => "denied",
            Error::Invalid(_) => "invalid",
            Error::Tampered(_) => "tampered",
            Error::Network(_) => "network",
            Error::TooLarge(_) => "tooLarge",
            Error::Cancelled => "cancelled",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Error", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// Result alias of the command surface.
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_kind_and_message() {
        let value = serde_json::to_value(Error::Denied("no".into())).unwrap();
        assert_eq!(value, serde_json::json!({ "kind": "denied", "message": "no" }));
    }
}
