//! Channel Lifecycle Management
//!
//! Manages channel/account states, connection health, and reconnection logic.
//! Similar to clawdbot's channel manager system.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, broadcast};
use tokio::time::Instant;
use rand::Rng;
use serde::{Deserialize, Serialize};

use super::types::Platform;

/// Channel configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConfig {
    pub platform: Platform,
    pub account_id: String,
    pub display_name: String,
    pub enabled: bool,
    #[serde(default)]
    pub reconnect_enabled: bool,
    #[serde(default = "default_reconnect_max_attempts")]
    pub reconnect_max_attempts: u32,
    #[serde(default = "default_initial_delay_ms")]
    pub initial_delay_ms: u64,
    #[serde(default = "default_max_delay_ms")]
    pub max_delay_ms: u64,
    #[serde(default = "default_health_check_interval_ms")]
    pub health_check_interval_ms: u64,
}

fn default_reconnect_max_attempts() -> u32 { 10 }
fn default_initial_delay_ms() -> u64 { 1000 }
fn default_max_delay_ms() -> u64 { 60000 }
fn default_health_check_interval_ms() -> u64 { 30000 }

impl Default for ChannelConfig {
    fn default() -> Self {
        Self {
            platform: Platform::Unknown,
            account_id: "default".to_string(),
            display_name: "Default".to_string(),
            enabled: true,
            reconnect_enabled: true,
            reconnect_max_attempts: 10,
            initial_delay_ms: 1000,
            max_delay_ms: 60000,
            health_check_interval_ms: 30000,
        }
    }
}

/// Connection state for a channel
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Failed,
}

/// Channel health status
#[derive(Debug, Clone)]
pub struct ChannelHealth {
    pub platform: Platform,
    pub account_id: String,
    pub state: ConnectionState,
    pub last_connected_at: Option<Instant>,
    pub last_disconnected_at: Option<Instant>,
    pub last_heartbeat_at: Option<Instant>,
    pub consecutive_failures: u32,
    pub message_count: u64,
    pub error_message: Option<String>,
}

/// Channel manager statistics
#[derive(Debug, Default)]
pub struct ChannelStats {
    pub total_channels: usize,
    pub connected_channels: usize,
    pub failed_channels: usize,
    pub total_messages: u64,
    pub total_reconnections: u64,
}

/// Channel entry in the manager
#[derive(Debug)]
struct ChannelEntry {
    config: ChannelConfig,
    state: ConnectionState,
    health: ChannelHealth,
    /// Broadcast channel for state changes
    state_tx: broadcast::Sender<ChannelStateEvent>,
    /// Current reconnect attempt
    reconnect_attempt: u32,
    /// Next reconnect time
    next_reconnect: Option<Instant>,
}

/// State change event
#[derive(Debug, Clone)]
pub struct ChannelStateEvent {
    pub platform: Platform,
    pub account_id: String,
    pub old_state: ConnectionState,
    pub new_state: ConnectionState,
    pub timestamp: Instant,
    pub error: Option<String>,
}

/// Channel lifecycle manager
#[derive(Debug, Default)]
pub struct ChannelManager {
    /// Channels indexed by (platform, account_id)
    channels: Arc<Mutex<HashMap<(Platform, String), ChannelEntry>>>,
    /// Statistics
    stats: Arc<Mutex<ChannelStats>>,
    /// Global state change broadcast
    events_tx: Arc<Mutex<Option<broadcast::Sender<ChannelStateEvent>>>>,
}

impl ChannelManager {
    /// Create a new channel manager
    pub fn new() -> Self {
        Self {
            channels: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(Mutex::new(ChannelStats::default())),
            events_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Set global event broadcast channel
    pub async fn set_events_tx(&self, tx: broadcast::Sender<ChannelStateEvent>) {
        let mut guard = self.events_tx.lock().await;
        *guard = Some(tx);
    }

    /// Add a channel configuration
    pub async fn add_channel(&self, config: ChannelConfig) {
        let key = (config.platform.clone(), config.account_id.clone());

        let (state_tx, _) = broadcast::channel(10);

        let health = ChannelHealth {
            platform: config.platform.clone(),
            account_id: config.account_id.clone(),
            state: ConnectionState::Disconnected,
            last_connected_at: None,
            last_disconnected_at: None,
            last_heartbeat_at: None,
            consecutive_failures: 0,
            message_count: 0,
            error_message: None,
        };

        let entry = ChannelEntry {
            config: config.clone(),
            state: ConnectionState::Disconnected,
            health,
            state_tx,
            reconnect_attempt: 0,
            next_reconnect: None,
        };

        let mut guard = self.channels.lock().await;
        guard.insert(key, entry);

        let mut stats = self.stats.lock().await;
        stats.total_channels += 1;
    }

    /// Remove a channel
    pub async fn remove_channel(&self, platform: &Platform, account_id: &str) -> bool {
        let mut guard = self.channels.lock().await;
        let key = (platform.clone(), account_id.to_string());

        let removed = guard.remove(&key).is_some();
        if removed {
            let mut stats = self.stats.lock().await;
            stats.total_channels = stats.total_channels.saturating_sub(1);
        }
        removed
    }

    /// Get channel configuration
    pub async fn get_channel(&self, platform: &Platform, account_id: &str) -> Option<ChannelConfig> {
        let guard = self.channels.lock().await;
        guard
            .get(&(platform.clone(), account_id.to_string()))
            .map(|e| e.config.clone())
    }

    /// Set channel state
    pub async fn set_state(
        &self,
        platform: &Platform,
        account_id: &str,
        new_state: ConnectionState,
        error: Option<String>,
    ) -> bool {
        let mut guard = self.channels.lock().await;
        let key = (platform.clone(), account_id.to_string());

        if let Some(entry) = guard.get_mut(&key) {
            let old_state = entry.state.clone();
            let state_for_health = new_state.clone();
            entry.state = new_state.clone();

            // Update health based on new state
            let now = Instant::now();
            match &state_for_health {
                ConnectionState::Connected => {
                    entry.health.state = state_for_health;
                    entry.health.last_connected_at = Some(now);
                    entry.health.consecutive_failures = 0;
                    entry.health.error_message = None;
                }
                ConnectionState::Disconnected => {
                    entry.health.state = state_for_health;
                    entry.health.last_disconnected_at = Some(now);
                }
                ConnectionState::Failed => {
                    entry.health.state = state_for_health;
                    entry.health.error_message = error.clone();
                    entry.health.consecutive_failures += 1;
                }
                _ => {
                    entry.health.state = state_for_health;
                }
            }

            // Emit state change event
            let event = ChannelStateEvent {
                platform: platform.clone(),
                account_id: account_id.to_string(),
                old_state,
                new_state,
                timestamp: Instant::now(),
                error,
            };

            let _ = entry.state_tx.send(event.clone());

            // Also emit to global channel if set
            if let Some(ref global_tx) = *self.events_tx.lock().await {
                let _ = global_tx.send(event);
            }

            true
        } else {
            false
        }
    }

    /// Get channel state
    pub async fn get_state(&self, platform: &Platform, account_id: &str) -> Option<ConnectionState> {
        let guard = self.channels.lock().await;
        guard
            .get(&(platform.clone(), account_id.to_string()))
            .map(|e| e.state.clone())
    }

    /// Get channel health
    pub async fn get_health(&self, platform: &Platform, account_id: &str) -> Option<ChannelHealth> {
        let guard = self.channels.lock().await;
        guard
            .get(&(platform.clone(), account_id.to_string()))
            .map(|e| e.health.clone())
    }

    /// Record a message sent
    pub async fn record_message(&self, platform: &Platform, account_id: &str) {
        let mut guard = self.channels.lock().await;
        if let Some(entry) = guard.get_mut(&(platform.clone(), account_id.to_string())) {
            entry.health.message_count += 1;

            let mut stats = self.stats.lock().await;
            stats.total_messages += 1;
        }
    }

    /// Record a heartbeat
    pub async fn record_heartbeat(&self, platform: &Platform, account_id: &str) {
        let mut guard = self.channels.lock().await;
        if let Some(entry) = guard.get_mut(&(platform.clone(), account_id.to_string())) {
            entry.health.last_heartbeat_at = Some(Instant::now());
        }
    }

    /// Get channels that need health checks
    pub async fn get_channels_for_health_check(&self) -> Vec<(Platform, String)> {
        let guard = self.channels.lock().await;
        let now = Instant::now();
        let interval = Duration::from_millis(
            guard.values()
                .next()
                .map(|e| e.config.health_check_interval_ms)
                .unwrap_or(30000)
        );

        guard
            .iter()
            .filter(|(_, entry)| {
                entry.state == ConnectionState::Connected &&
                entry.health.last_heartbeat_at.map_or(true, |hb| now.duration_since(hb) > interval)
            })
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// Get channels that need reconnection
    pub async fn get_channels_for_reconnect(&self) -> Vec<(Platform, String)> {
        let guard = self.channels.lock().await;
        let now = Instant::now();

        guard
            .iter()
            .filter(|(_, entry)| {
                entry.state == ConnectionState::Disconnected ||
                entry.state == ConnectionState::Failed
            })
            .filter_map(|(k, entry)| {
                if let Some(next) = entry.next_reconnect {
                    if now >= next {
                        Some(k.clone())
                    } else {
                        None
                    }
                } else if entry.config.reconnect_enabled {
                    Some(k.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    /// Schedule a reconnect
    pub async fn schedule_reconnect(&self, platform: &Platform, account_id: &str) {
        let mut guard = self.channels.lock().await;
        let key = (platform.clone(), account_id.to_string());

        if let Some(entry) = guard.get_mut(&key) {
            entry.reconnect_attempt += 1;
            if entry.reconnect_attempt > entry.config.reconnect_max_attempts {
                // Max attempts reached
                entry.state = ConnectionState::Failed;
                entry.health.error_message = Some("Max reconnect attempts reached".to_string());
                return;
            }

            // Calculate delay with exponential backoff
            let base_delay = entry.config.initial_delay_ms;
            let max_delay = entry.config.max_delay_ms;

            // Exponential backoff: delay * 2^(attempt-1), with some randomness
            let delay_ms = std::cmp::min(
                base_delay * (2_u64.pow(entry.reconnect_attempt.saturating_sub(1))),
                max_delay,
            );

            // Add 10-20% randomness
            let randomness = (delay_ms / 10) + (delay_ms % 10);
            let delay_ms = delay_ms + (rand::random::<u64>() % randomness);

            entry.next_reconnect = Some(Instant::now() + Duration::from_millis(delay_ms));
            entry.state = ConnectionState::Reconnecting;

            let mut stats = self.stats.lock().await;
            stats.total_reconnections += 1;
        }
    }

    /// Get statistics
    pub async fn get_stats(&self) -> ChannelStats {
        let guard = self.channels.lock().await;
        let mut stats = ChannelStats {
            total_channels: guard.len(),
            connected_channels: 0,
            failed_channels: 0,
            total_messages: 0,
            total_reconnections: self.stats.lock().await.total_reconnections,
        };

        for entry in guard.values() {
            match entry.state {
                ConnectionState::Connected => stats.connected_channels += 1,
                ConnectionState::Failed => stats.failed_channels += 1,
                _ => {}
            }
            stats.total_messages += entry.health.message_count;
        }

        stats
    }

    /// Get all channels
    pub async fn get_all_channels(&self) -> Vec<(ChannelConfig, ConnectionState)> {
        let guard = self.channels.lock().await;
        guard
            .values()
            .map(|e| (e.config.clone(), e.state.clone()))
            .collect()
    }

    /// Subscribe to channel state changes
    pub async fn subscribe(
        &self,
        platform: &Platform,
        account_id: &str,
    ) -> Option<broadcast::Receiver<ChannelStateEvent>> {
        let guard = self.channels.lock().await;
        guard
            .get(&(platform.clone(), account_id.to_string()))
            .map(|e| e.state_tx.subscribe())
    }

    /// Subscribe to all channel state changes
    pub async fn subscribe_all(&self) -> Option<broadcast::Receiver<ChannelStateEvent>> {
        let guard = self.events_tx.lock().await;
        guard.as_ref().map(|tx| tx.subscribe())
    }
}

/// Calculate reconnect delay with exponential backoff
pub fn calculate_reconnect_delay(attempt: u32, base_delay_ms: u64, max_delay_ms: u64) -> Duration {
    let delay = std::cmp::min(
        base_delay_ms * (2_u64.pow(attempt.saturating_sub(1))),
        max_delay_ms,
    );
    Duration::from_millis(delay)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> ChannelConfig {
        ChannelConfig {
            platform: Platform::Discord,
            account_id: "test-account".to_string(),
            display_name: "Test Account".to_string(),
            enabled: true,
            reconnect_enabled: true,
            reconnect_max_attempts: 3,
            initial_delay_ms: 100,
            max_delay_ms: 1000,
            health_check_interval_ms: 5000,
        }
    }

    #[tokio::test]
    async fn test_add_channel() {
        let manager = ChannelManager::new();
        let config = create_test_config();

        manager.add_channel(config).await;

        let state = manager.get_state(&Platform::Discord, "test-account").await;
        assert_eq!(state, Some(ConnectionState::Disconnected));
    }

    #[tokio::test]
    async fn test_set_state() {
        let manager = ChannelManager::new();
        let config = create_test_config();
        manager.add_channel(config).await;

        let result = manager.set_state(&Platform::Discord, "test-account", ConnectionState::Connected, None).await;
        assert!(result);

        let state = manager.get_state(&Platform::Discord, "test-account").await;
        assert_eq!(state, Some(ConnectionState::Connected));
    }

    #[tokio::test]
    async fn test_record_message() {
        let manager = ChannelManager::new();
        let config = create_test_config();
        manager.add_channel(config).await;

        manager.record_message(&Platform::Discord, "test-account").await;
        manager.record_message(&Platform::Discord, "test-account").await;

        let health = manager.get_health(&Platform::Discord, "test-account").await;
        assert_eq!(health.unwrap().message_count, 2);
    }

    #[tokio::test]
    async fn test_schedule_reconnect() {
        let manager = ChannelManager::new();
        let config = create_test_config();
        manager.add_channel(config).await;

        manager.schedule_reconnect(&Platform::Discord, "test-account").await;

        let state = manager.get_state(&Platform::Discord, "test-account").await;
        assert_eq!(state, Some(ConnectionState::Reconnecting));
    }

    #[tokio::test]
    async fn test_get_stats() {
        let manager = ChannelManager::new();
        let config = create_test_config();
        manager.add_channel(config).await;

        manager.set_state(&Platform::Discord, "test-account", ConnectionState::Connected, None).await;
        manager.record_message(&Platform::Discord, "test-account").await;

        let stats = manager.get_stats().await;
        assert_eq!(stats.total_channels, 1);
        assert_eq!(stats.connected_channels, 1);
    }

    #[tokio::test]
    async fn test_calculate_reconnect_delay() {
        let delay1 = calculate_reconnect_delay(1, 1000, 60000);
        assert_eq!(delay1, Duration::from_millis(1000));

        let delay2 = calculate_reconnect_delay(2, 1000, 60000);
        assert_eq!(delay2, Duration::from_millis(2000));

        let delay3 = calculate_reconnect_delay(3, 1000, 60000);
        assert_eq!(delay3, Duration::from_millis(4000));
    }
}