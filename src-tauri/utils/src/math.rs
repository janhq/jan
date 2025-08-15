const MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
const MCP_MAX_RESTART_DELAY_MS: u64 = 30000; // Cap at 30 seconds
const MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time

/// Calculate exponential backoff delay with jitter
///
/// # Arguments
/// * `attempt` - The current restart attempt number (1-based)
///
/// # Returns
/// * `u64` - Delay in milliseconds, capped at MCP_MAX_RESTART_DELAY_MS
pub fn calculate_exponential_backoff_delay(attempt: u32) -> u64 {
    use std::cmp;

    // Calculate base exponential delay: base_delay * multiplier^(attempt-1)
    let exponential_delay =
        (MCP_BASE_RESTART_DELAY_MS as f64) * MCP_BACKOFF_MULTIPLIER.powi((attempt - 1) as i32);

    // Cap the delay at maximum
    let capped_delay = cmp::min(exponential_delay as u64, MCP_MAX_RESTART_DELAY_MS);

    // Add jitter (±25% randomness) to prevent thundering herd
    let jitter_range = (capped_delay as f64 * 0.25) as u64;
    let jitter = if jitter_range > 0 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Use attempt number as seed for deterministic but varied jitter
        let mut hasher = DefaultHasher::new();
        attempt.hash(&mut hasher);
        let hash = hasher.finish();

        // Convert hash to jitter value in range [-jitter_range, +jitter_range]
        let jitter_offset = (hash % (jitter_range * 2)) as i64 - jitter_range as i64;
        jitter_offset
    } else {
        0
    };

    // Apply jitter while ensuring delay stays positive and within bounds
    let final_delay = cmp::max(
        100, // Minimum 100ms delay
        cmp::min(
            MCP_MAX_RESTART_DELAY_MS,
            (capped_delay as i64 + jitter) as u64,
        ),
    );

    final_delay
}
