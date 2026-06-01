/// Absolute ceiling for in-process document parsing, in bytes.
///
/// The user-facing limit is the `max_file_size_mb` RAG setting (1–200MB),
/// enforced on the frontend before any file reaches the parser. This backstop
/// only guards the parser against pathological inputs, so it is pinned to the
/// maximum that setting permits — a smaller value here would wrongly reject
/// files the user explicitly allowed (e.g. a 21.5MB file with a 50MB setting).
pub const MAX_PARSE_FILE_SIZE: u64 = 200 * 1024 * 1024;
