/**
 * Gateway service implementation for Tauri backend
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  GatewayServiceInterface,
  GatewayConfig,
  GatewayStatus,
  GatewayMessage,
  ConnectionState,
  ThreadMapping,
  Platform,
} from './types';

export function createGatewayService(): GatewayServiceInterface {
  const unsubscribers: (() => void)[] = [];

  return {
    async startServer(config: GatewayConfig): Promise<void> {
      await invoke('gateway_start_server', { config });
    },

    async stopServer(): Promise<void> {
      await invoke('gateway_stop_server');
    },

    async getStatus(): Promise<GatewayStatus> {
      return await invoke('gateway_get_status');
    },

    async configureDiscord(webhookUrl: string | null, botToken: string | null): Promise<void> {
      await invoke('gateway_configure_discord', {
        webhookUrl: webhookUrl || null,
        botToken: botToken || null,
      });
    },

    async sendResponse(channelId: string, content: string): Promise<void> {
      await invoke('gateway_send_response', {
        response: {
          targetPlatform: 'discord', // Will be set properly by caller
          targetChannelId: channelId,
          content,
          replyTo: null,
          mentions: [],
        },
      });
    },

    async getConnections(): Promise<ConnectionState[]> {
      return await invoke('gateway_get_connections');
    },

    async getThreadMappings(): Promise<ThreadMapping[]> {
      return await invoke('gateway_get_thread_mappings');
    },

    async addThreadMapping(
      platform: Platform,
      externalId: string,
      janThreadId: string
    ): Promise<void> {
      await invoke('gateway_add_thread_mapping', {
        platform,
        externalId,
        janThreadId,
      });
    },

    async removeThreadMapping(
      platform: Platform,
      externalId: string
    ): Promise<boolean> {
      return await invoke('gateway_remove_thread_mapping', {
        platform,
        externalId,
      });
    },

    onMessage(platform: Platform, handler: (message: GatewayMessage) => void): () => void {
      const eventName = `gateway:message:${platform}`;
      console.log(`[GatewayTauri] 📡 Setting up listener for event: ${eventName}`);

      const unlisten = listen<GatewayMessage>(eventName, (event) => {
        console.log(`[GatewayTauri] 📨 EVENT RECEIVED: ${eventName}`, {
          id: event.payload.id,
          channel: event.payload.channelId,
          content: event.payload.content.substring(0, 50),
        });
        handler(event.payload);
      });

      // Store the unlisten promise
      unlisten.then((fn) => {
        unsubscribers.push(fn);
      });

      // Return cleanup function
      return () => {
        unlisten.then((fn) => fn());
      };
    },

    onStatusChange(handler: (status: GatewayStatus) => void): () => void {
      const unlisten = listen<GatewayStatus>('gateway:status', (event) => {
        handler(event.payload);
      });

      unlisten.then((fn) => {
        unsubscribers.push(fn);
      });

      return () => {
        unlisten.then((fn) => fn());
      };
    },

    onConnectionChange(
      handler: (connections: ConnectionState[]) => void
    ): () => void {
      // Listen for connection change events
      const unlisten = listen<ConnectionState[]>('gateway:connections', (event) => {
        handler(event.payload);
      });

      unlisten.then((fn) => {
        unsubscribers.push(fn);
      });

      return () => {
        unlisten.then((fn) => fn());
      };
    },
  };
}

/**
 * Cleanup all event listeners
 */
export function cleanupGatewayService(): void {
  // This would be called when the service is no longer needed
  // In a real implementation, you'd track all listeners and clean them up
}