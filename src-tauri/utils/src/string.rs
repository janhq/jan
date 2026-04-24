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
}
