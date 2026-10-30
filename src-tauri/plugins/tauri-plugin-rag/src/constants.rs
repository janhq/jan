/// Absolute ceiling for in-process document parsing, in bytes.
///
/// The user-facing limit is the `max_file_size_mb` RAG setting (1–200MB),
/// enforced on the frontend before any file reaches the parser. This backstop
/// only guards the parser against pathological inputs, so it is pinned to the
/// maximum that setting permits — a smaller value here would wrongly reject
/// files the user explicitly allowed (e.g. a 21.5MB file with a 50MB setting).
pub const MAX_PARSE_FILE_SIZE: u64 = 200 * 1024 * 1024;

/// Most one zip entry (a docx or pptx XML part, a spreadsheet part) may inflate
/// to, in bytes. `MAX_PARSE_FILE_SIZE` bounds the file on disk, but deflate
/// shrinks repeated bytes about a thousand to one, so a file well under that
/// limit can still unpack to many gigabytes. Real text parts are a few
/// megabytes; this leaves two orders of magnitude of headroom.
pub const MAX_ZIP_ENTRY_SIZE: u64 = 100 * 1024 * 1024;

/// Most all entries of one zip may inflate to together, in bytes.
pub const MAX_ZIP_TOTAL_SIZE: u64 = 256 * 1024 * 1024;
