/**
 * Gateway event handling hook
 *
 * Listens for gateway events and processes messages through Jan's API.
 */

import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useGatewayStore } from './useGateway';
import type { GatewayMessage, Platform } from '../services/gateway';

interface UseGatewayEventsOptions {
  /** Called when a new message is received */
  onMessage?: (message: GatewayMessage) => Promise<void>;
  /** Called when a new thread needs to be created */
  onCreateThread?: (message: GatewayMessage) => Promise<string>;
  /** Called when status changes */
  onStatusChange?: (running: boolean) => void;
  /** Platforms to listen for */
  platforms?: Platform[];
}

export function useGatewayEvents(options: UseGatewayEventsOptions = {}) {
  const {
    onMessage,
    onCreateThread,
    onStatusChange,
    platforms = ['discord', 'slack', 'telegram'],
  } = options;

  const threadMappings = useGatewayStore((state) => state.threadMappings);
  const messages = useGatewayStore((state) => state.messages);
  const processedRef = useRef<Set<string>>(new Set());

  // Check if thread already exists for a channel
  const findExistingThread = useCallback(
    (platform: Platform, channelId: string): string | null => {
      const mapping = threadMappings.find(
        (m) => m.platform === platform && m.externalId === channelId
      );
      return mapping?.janThreadId || null;
    },
    [threadMappings]
  );

  // Process incoming message
  const processMessage = useCallback(
    async (message: GatewayMessage) => {
      // Skip if already processed
      if (processedRef.current.has(message.id)) {
        console.log(`[Gateway] Message ${message.id} already processed, skipping`);
        return;
      }
      processedRef.current.add(message.id);

      console.log(`[Gateway] Processing ${message.platform} message:`, message.id);

      // Check for existing thread
      const existingThreadId = findExistingThread(message.platform, message.channelId);

      if (existingThreadId) {
        // Inject message into existing thread
        console.log(`[Gateway] Injecting into existing thread: ${existingThreadId}`);
        if (onMessage) {
          await onMessage(message);
        } else {
          await injectMessage(existingThreadId, message);
        }
      } else if (onCreateThread) {
        // Create new thread
        console.log(`[Gateway] Creating new thread for ${message.platform}:${message.channelId}`);
        const threadId = await onCreateThread(message);
        console.log(`[Gateway] Thread created: ${threadId}`);
      } else {
        // Default: create thread and inject message
        const threadId = await createThreadAndInject(message);
        console.log(`[Gateway] Thread created: ${threadId}`);
      }
    },
    [findExistingThread, onMessage, onCreateThread]
  );

  // Subscribe to new messages from the store
  useEffect(() => {
    const processAllMessages = async () => {
      for (const [channelId, channelMessages] of messages.entries()) {
        for (const message of channelMessages) {
          if (!processedRef.current.has(message.id)) {
            await processMessage(message);
          }
        }
      }
    };

    processAllMessages();
  }, [messages, processMessage]);

  // Listen for gateway events (status changes)
  useEffect(() => {
    let isMounted = true;

    const setupListeners = async () => {
      // Listen for status changes
      try {
        const unlistenStatus = await listen<{ running: boolean }>(
          'gateway:status',
          (event) => {
            if (isMounted && onStatusChange) {
              onStatusChange(event.payload.running);
            }
          }
        );

        // Process any messages that were added before listeners were set up
        const processPendingMessages = async () => {
          for (const [channelId, channelMessages] of messages.entries()) {
            for (const message of channelMessages) {
              if (!processedRef.current.has(message.id)) {
                await processMessage(message);
              }
            }
          }
        };

        // Initial check for pending messages
        setTimeout(processPendingMessages, 1000);

        return () => {
          unlistenStatus();
        };
      } catch (error) {
        console.error('[Gateway] Failed to set up listeners:', error);
        return () => {};
      }
    };

    const cleanup = setupListeners();

    return () => {
      isMounted = false;
      cleanup.then(fn => fn && fn());
    };
  }, [onStatusChange, processMessage, messages]);

  return {
    /** Manually trigger message processing */
    processMessage,
  };
}

/**
 * Inject a message into an existing Jan thread
 */
async function injectMessage(threadId: string, message: GatewayMessage): Promise<void> {
  const janMessage = {
    thread_id: threadId,
    role: 'user',
    content: [
      {
        type: 'text',
        text: {
          value: message.content,
          annotations: [
            {
              type: 'source_user_id',
              source_user_id: message.userId,
            },
          ],
        },
      },
    ],
    metadata: {
      gateway_source: {
        platform: message.platform,
        user_id: message.userId,
        channel_id: message.channelId,
        message_id: message.id,
      },
    },
  };

  await invoke('create_message', { message: janMessage });
}

/**
 * Create a new thread and inject the message
 */
async function createThreadAndInject(message: GatewayMessage): Promise<string> {
  // Create thread
  const thread = await invoke<{ id: string }>('create_thread', {
    thread: {
      title: `${message.platform.toUpperCase()} - ${message.channelId}`,
      metadata: {
        gateway: {
          platform: message.platform,
          channel_id: message.channelId,
          user_id: message.userId,
        },
      },
    },
  });

  const threadId = thread.id;

  // Add thread mapping
  await invoke('gateway_add_thread_mapping', {
    platform: message.platform,
    externalId: message.channelId,
    janThreadId: threadId,
  });

  // Inject message
  await injectMessage(threadId, message);

  return threadId;
}

export default useGatewayEvents;