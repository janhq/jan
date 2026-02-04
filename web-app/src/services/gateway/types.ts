/**
 * Gateway service types for TypeScript
 */

export type Platform = 'discord' | 'slack' | 'telegram' | 'unknown';

export interface GatewayConfig {
  httpPort: number;
  wsPort: number;
  enabled: boolean;
  whitelist: WhitelistConfig;
  autoCreateThreads: boolean;
  defaultAssistantId: string | null;
  discordWebhookUrl: string | null;
  discordBotToken: string | null;
}

export interface WhitelistConfig {
  enabled: boolean;
  userIds: string[];
  channelIds: string[];
  guildIds: string[];
  roleIds: string[];
}

export interface GatewayMessage {
  id: string;
  platform: Platform;
  userId: string;
  channelId: string;
  guildId: string | null;
  content: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface GatewayResponse {
  targetPlatform: Platform;
  targetChannelId: string;
  content: string;
  replyTo: string | null;
  mentions: string[];
}

export interface GatewayStatus {
  running: boolean;
  httpPort: number;
  wsPort: number;
  activeConnections: number;
  queuedMessages: number;
}

export interface ConnectionState {
  platform: Platform;
  connected: boolean;
  lastHeartbeat: number;
  messageCount: number;
}

export interface ThreadMapping {
  platform: Platform;
  externalId: string;
  janThreadId: string;
  createdAt: number;
  lastMessageAt: number;
}

export interface GatewayServiceInterface {
  startServer(config: GatewayConfig): Promise<void>;
  stopServer(): Promise<void>;
  getStatus(): Promise<GatewayStatus>;
  configureDiscord(webhookUrl: string | null, botToken: string | null): Promise<void>;
  sendResponse(channelId: string, content: string): Promise<void>;
  getConnections(): Promise<ConnectionState[]>;
  getThreadMappings(): Promise<ThreadMapping[]>;
  addThreadMapping(
    platform: Platform,
    externalId: string,
    janThreadId: string
  ): Promise<void>;
  removeThreadMapping(platform: Platform, externalId: string): Promise<boolean>;
  onMessage(
    platform: Platform,
    handler: (message: GatewayMessage) => void
  ): () => void;
  onStatusChange(handler: (status: GatewayStatus) => void): () => void;
  onConnectionChange(
    handler: (connections: ConnectionState[]) => void
  ): () => void;
}