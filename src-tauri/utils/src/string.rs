/// Parses 16-byte array to UUID string format
pub fn parse_uuid(bytes: &[u8; 16]) -> String {
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // 4-2-2-2-6 bytes
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

/// Safely converts C string buffer to Rust String
pub fn parse_c_string(buf: &[i8]) -> String {
    let bytes: Vec<u8> = buf
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Formats any Display error to "Error: {}" string
pub fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {}", e)
}

/// Finds memory patterns in text using parentheses parsing
pub fn find_memory_pattern(text: &str) -> Option<(usize, &str)> {
    // Find the last parenthesis that contains the memory pattern
    let mut last_match = None;
    let mut chars = text.char_indices().peekable();

    while let Some((start_idx, ch)) = chars.next() {
        if ch == '(' {
            // Find the closing parenthesis
            let remaining = &text[start_idx + 1..];
            if let Some(close_pos) = remaining.find(')') {
                let content = &remaining[..close_pos];

                // Check if this looks like memory info
                if is_memory_pattern(content) {
                    last_match = Some((start_idx, content));
                }
            }
        }
    }

    last_match
}

/// Validates if content matches memory pattern format
pub fn is_memory_pattern(content: &str) -> bool {
    // Check if content matches pattern like "8128 MiB, 8128 MiB free"
    // Must contain: numbers, "MiB", comma, "free"
    if !(content.contains("MiB") && content.contains("free") && content.contains(',')) {
        return false;
    }

    let parts: Vec<&str> = content.split(',').collect();
    if parts.len() != 2 {
        return false;
    }

    parts.iter().all(|part| {
        let part = part.trim();
        // Each part should start with a number and contain "MiB"
        part.split_whitespace()
            .next()
            .map_or(false, |first_word| first_word.parse::<i32>().is_ok())
            && part.contains("MiB")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_uuid() {
        let uuid_bytes = [
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88
        ];
        
        let uuid_string = parse_uuid(&uuid_bytes);
        assert_eq!(uuid_string, "12345678-9abc-def0-1122-334455667788");
    }

    #[test]
    fn test_parse_uuid_zeros() {
        let zero_bytes = [0; 16];
        let uuid_string = parse_uuid(&zero_bytes);
        assert_eq!(uuid_string, "00000000-0000-0000-0000-000000000000");
    }

    #[test]
    fn test_parse_uuid_max_values() {
        let max_bytes = [0xff; 16];
        let uuid_string = parse_uuid(&max_bytes);
        assert_eq!(uuid_string, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    }

    #[test]
    fn test_parse_c_string() {
        let c_string = [b'H' as i8, b'e' as i8, b'l' as i8, b'l' as i8, b'o' as i8, 0, b'W' as i8];
        let result = parse_c_string(&c_string);
        assert_eq!(result, "Hello");
    }

    #[test]
    fn test_parse_c_string_empty() {
        let empty_c_string = [0];
        let result = parse_c_string(&empty_c_string);
        assert_eq!(result, "");
    }

    #[test]
    fn test_parse_c_string_no_null_terminator() {
        let no_null = [b'T' as i8, b'e' as i8, b's' as i8, b't' as i8];
        let result = parse_c_string(&no_null);
        assert_eq!(result, "Test");
    }

    #[test]
    fn test_parse_c_string_with_negative_values() {
        let with_negative = [-1, b'A' as i8, b'B' as i8, 0];
        let result = parse_c_string(&with_negative);
        // Should convert negative to unsigned byte
        assert!(result.len() > 0);
        assert!(result.contains('A'));
        assert!(result.contains('B'));
    }

    #[test]
    fn test_err_to_string() {
        let error_msg = "Something went wrong";
        let result = err_to_string(error_msg);
        assert_eq!(result, "Error: Something went wrong");
        
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "File not found");
        let result = err_to_string(io_error);
        assert!(result.starts_with("Error: "));
        assert!(result.contains("File not found"));
    }

    #[test]
    fn test_is_memory_pattern_valid() {
        assert!(is_memory_pattern("8128 MiB, 8128 MiB free"));
        assert!(is_memory_pattern("1024 MiB, 512 MiB free"));
        assert!(is_memory_pattern("16384 MiB, 12000 MiB free"));
        assert!(is_memory_pattern("0 MiB, 0 MiB free"));
    }

    #[test]
    fn test_is_memory_pattern_invalid() {
        assert!(!is_memory_pattern("8128 MB, 8128 MB free")); // Wrong unit
        assert!(!is_memory_pattern("8128 MiB 8128 MiB free")); // Missing comma
        assert!(!is_memory_pattern("8128 MiB, 8128 MiB used")); // Wrong second part
        assert!(!is_memory_pattern("not_a_number MiB, 8128 MiB free")); // Invalid number
        assert!(!is_memory_pattern("8128 MiB")); // Missing second part
        assert!(!is_memory_pattern("")); // Empty string
        assert!(!is_memory_pattern("8128 MiB, free")); // Missing number in second part
    }

    #[test]
    fn test_find_memory_pattern() {
        let text = "Loading model... (8128 MiB, 4096 MiB free) completed";
        let result = find_memory_pattern(text);
        assert!(result.is_some());
        let (start_idx, content) = result.unwrap();
        assert!(start_idx > 0);
        assert_eq!(content, "8128 MiB, 4096 MiB free");
    }

    #[test]
    fn test_find_memory_pattern_multiple_parentheses() {
        let text = "Start (not memory) then (1024 MiB, 512 MiB free) and (2048 MiB, 1024 MiB free) end";
        let result = find_memory_pattern(text);
        assert!(result.is_some());
        let (_, content) = result.unwrap();
        // Should return the LAST valid memory pattern
        assert_eq!(content, "2048 MiB, 1024 MiB free");
    }

    #[test]
    fn test_find_memory_pattern_no_match() {
        let text = "No memory info here";
        assert!(find_memory_pattern(text).is_none());
        
        let text_with_invalid = "Some text (invalid memory info) here";
        assert!(find_memory_pattern(text_with_invalid).is_none());
    }

    #[test]
    fn test_find_memory_pattern_unclosed_parenthesis() {
        let text = "Unclosed (8128 MiB, 4096 MiB free";
        assert!(find_memory_pattern(text).is_none());
    }
}
