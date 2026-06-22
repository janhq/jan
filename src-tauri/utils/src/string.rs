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
