/**
 * Shared types for the OpenClaw remote access integration.
 * These mirror the Rust backend types in src-tauri/src/core/openclaw/models.rs.
 */

export type ChannelType = 'telegram' | 'whatsapp'

export interface TelegramConfig {
  bot_token: string
  bot_username: string | null
  connected: boolean
  pairing_code: string | null
  paired_users: number
}

export interface WhatsAppConfig {
  account_id: string
  session_path: string
  connected: boolean
  phone_number: string | null
  qr_code: string | null
  contacts_count: number
}

export type ChannelConfig = TelegramConfig | WhatsAppConfig

export interface OpenClawStatus {
  installed: boolean
  running: boolean
  runtime_version: string | null
  openclaw_version: string | null
  port_available: boolean
  error: string | null
  sandbox_type?: string | null
  isolation_tier?: string | null
}

export type TunnelProvider = 'none' | 'tailscale' | 'ngrok' | 'cloudflare' | 'localonly'

export interface TunnelInfo {
  provider: TunnelProvider
  url: string
  started_at: string
  port: number
  is_public: boolean
}

export interface TunnelProvidersStatus {
  tailscale: { installed: boolean; authenticated: boolean; version: string | null }
  ngrok: { installed: boolean; authenticated: boolean; version: string | null }
  cloudflare: { installed: boolean; authenticated: boolean; version: string | null }
  active_provider: TunnelProvider
  active_tunnel: TunnelInfo | null
}

export type GatewayMode = 'embedded' | 'remote'

export interface JanGatewaySettings {
  mode: GatewayMode
  remote_url?: string
  remote_token?: string
}

export interface SecurityStatus {
  auth_mode: 'token' | 'password' | 'none'
  has_token: boolean
  has_password: boolean
  require_pairing: boolean
  approved_device_count: number
  recent_auth_failures: number
}
