/*!
   Thread and Message Persistence Module

   This module provides all logic for managing threads and their messages, including creation, modification, deletion, and listing.
   Messages for each thread are persisted in a JSONL file (messages.jsonl) per thread directory.

   **Concurrency and Consistency Guarantee:**
   - All operations that write or modify messages for a thread are protected by a global, per-thread asynchronous lock.
   - This design ensures that only one operation can write to a thread's messages.jsonl file at a time, preventing race conditions.
   - As a result, the messages.jsonl file for each thread is always consistent and never corrupted, even under concurrent access.
*/

pub mod commands;
mod constants;
#[cfg(any(target_os = "android", target_os = "ios"))]
pub mod db;
pub mod helpers;
pub mod utils;

#[cfg(test)]
mod tests;
