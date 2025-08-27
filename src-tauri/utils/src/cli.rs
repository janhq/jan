/// Extracts the value of a command line argument flag from args vector
pub fn extract_arg_value(args: &[String], flag: &str) -> String {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default()
}

/// Parses port from command line arguments with fallback to default (8080)
pub fn parse_port_from_args(args: &[String]) -> i32 {
    let port_str = extract_arg_value(args, "--port");
    match port_str.parse() {
        Ok(p) => p,
        Err(_) => {
            eprintln!("Invalid port value: '{}', using default 8080", port_str);
            8080
        }
    }
}
