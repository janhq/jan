/**
 * Gateway state management with Zustand
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  GatewayConfig,
  GatewayStatus,
  GatewayMessage,
  ConnectionState,
  ThreadMapping,
  Platform,
} from '../services/gateway';
import { createGatewayService } from '../services/gateway';

interface GatewayState {
  // Server status
  status: GatewayStatus | null;
  isRunning: boolean;

  // Configuration
  config: GatewayConfig | null;

  // Active connections
  connections: ConnectionState[];

  // Messages
  messages: Map<string, GatewayMessage[]>;

  // Thread mappings
  threadMappings: ThreadMapping[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  startServer: (config: GatewayConfig) => Promise<void>;
  stopServer: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  sendResponse: (channelId: string, content: string) => Promise<void>;
  clearError: () => void;

  // Message handling
  addMessage: (message: GatewayMessage) => void;
  clearMessages: (channelId?: string) => void;

  // Thread mapping management
  addThreadMapping: (
    platform: Platform,
    externalId: string,
    janThreadId: string
  ) => Promise<void>;
  removeThreadMapping: (platform: Platform, externalId: string) => Promise<boolean>;
}

// Create the service
const gatewayService = createGatewayService();

export const useGatewayStore = create<GatewayState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    status: null,
    isRunning: false,
    config: null,
    connections: [],
    messages: new Map(),
    threadMappings: [],
    isLoading: false,
    error: null,

    // Actions
    startServer: async (config: GatewayConfig) => {
      set({ isLoading: true, error: null });
      try {
        await gatewayService.startServer(config);
        set({
          config,
          isLoading: false,
          isRunning: true,
        });
        // Start polling for status
        get().fetchStatus();
      } catch (error) {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to start server',
        });
      }
    },

    stopServer: async () => {
      set({ isLoading: true, error: null });
      try {
        await gatewayService.stopServer();
        set({
          isLoading: false,
          isRunning: false,
          status: null,
        });
      } catch (error) {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to stop server',
        });
      }
    },

    fetchStatus: async () => {
      try {
        const status = await gatewayService.getStatus();
        set({
          status,
          isRunning: status.running,
        });
      } catch (error) {
        console.error('Failed to fetch gateway status:', error);
      }
    },

    sendResponse: async (channelId: string, content: string) => {
      try {
        await gatewayService.sendResponse(channelId, content);
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to send response',
        });
      }
    },

    clearError: () => {
      set({ error: null });
    },

    addMessage: (message: GatewayMessage) => {
      const { messages } = get();
      const channelMessages = messages.get(message.channelId) || [];
      channelMessages.push(message);
      messages.set(message.channelId, channelMessages);
      set({ messages: new Map(messages) });
    },

    clearMessages: (channelId?: string) => {
      const { messages } = get();
      if (channelId) {
        messages.delete(channelId);
      } else {
        messages.clear();
      }
      set({ messages: new Map(messages) });
    },

    addThreadMapping: async (
      platform: Platform,
      externalId: string,
      janThreadId: string
    ) => {
      try {
        await gatewayService.addThreadMapping(platform, externalId, janThreadId);
        const { threadMappings } = get();
        set({
          threadMappings: [
            ...threadMappings,
            {
              platform,
              externalId,
              janThreadId,
              createdAt: Date.now(),
              lastMessageAt: Date.now(),
            },
          ],
        });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to add thread mapping',
        });
      }
    },

    removeThreadMapping: async (platform: Platform, externalId: string) => {
      try {
        const removed = await gatewayService.removeThreadMapping(platform, externalId);
        if (removed) {
          const { threadMappings } = get();
          set({
            threadMappings: threadMappings.filter(
              (m) => !(m.platform === platform && m.externalId === externalId)
            ),
          });
        }
        return removed;
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to remove thread mapping',
        });
        return false;
      }
    },
  }))
);

// Selectors
export const useGatewayStatus = () =>
  useGatewayStore((state) => state.status);

export const useIsGatewayRunning = () =>
  useGatewayStore((state) => state.isRunning);

export const useGatewayConnections = () =>
  useGatewayStore((state) => state.connections);

export const useGatewayError = () =>
  useGatewayStore((state) => state.error);

export const useGatewayThreadMappings = () =>
  useGatewayStore((state) => state.threadMappings);

// Initialize event listeners
if (typeof window !== 'undefined') {
  // Always listen for gateway events - status changes will trigger listener setup
  const platforms: Platform[] = ['discord', 'slack', 'telegram'];

  // Listen for status changes
  gatewayService.onStatusChange((status) => {
    console.log('[Gateway] Status changed:', status.running ? 'RUNNING' : 'STOPPED',
      `http=${status.httpPort}, ws=${status.wsPort}, queued=${status.queuedMessages}`);
    useGatewayStore.setState({
      status,
      isRunning: status.running,
    });
  });

  // Listen for messages from each platform and process them
  platforms.forEach((platform) =>
    gatewayService.onMessage(platform, async (message) => {
      console.log('[Gateway] 📨 RECEIVED', platform, 'message:', {
        id: message.id,
        user: message.userId,
        channel: message.channelId,
        content: message.content.substring(0, 80) + (message.content.length > 80 ? '...' : ''),
      });

      // Add to store
      useGatewayStore.getState().addMessage(message);

      // Check for existing thread mapping
      const threadMappings = useGatewayStore.getState().threadMappings;
      const existingMapping = threadMappings.find(
        (m) => m.platform === platform && m.externalId === message.channelId
      );

      if (existingMapping) {
        console.log('[Gateway] 🔗 Found existing thread mapping:', existingMapping.janThreadId);
        // Inject message into existing thread
        await injectMessageIntoThread(existingMapping.janThreadId, message);
      } else {
        console.log('[Gateway] 🆕 No thread mapping for', platform, ':', message.channelId);
        // Create new thread
        await createThreadAndInject(platform, message.channelId, message);
      }
    })
  );

  // Listen for assistant responses in gateway threads and send back to platform
  setupAssistantResponseListener();

  // Initial status fetch
  useGatewayStore.getState().fetchStatus();
}

/**
 * Listen for assistant messages in gateway threads and send them back to platforms
 */
async function setupAssistantResponseListener() {
  // Poll for new messages in gateway threads
  const gatewayThreads = useGatewayStore.getState().threadMappings;

  if (gatewayThreads.length === 0) {
    console.log('[Gateway] No gateway threads to monitor for responses');
    return;
  }

  // Set up polling to check for assistant responses
  setInterval(async () => {
    for (const mapping of gatewayThreads) {
      try {
        // Get latest messages from this thread
        const messages = await invoke<any[]>('list_messages', { threadId: mapping.janThreadId });

        if (messages && messages.length > 0) {
          // Find the most recent assistant message that hasn't been sent yet
          const recentMessages = messages.slice(-5); // Check last 5 messages

          for (const msg of recentMessages) {
            const role = msg.role;
            const content = extractMessageContent(msg);
            const msgId = msg.id;

            // Skip if not an assistant message or already sent
            if (role !== 'assistant' || !content) continue;

            // Check if this is a gateway thread and hasn't been responded
            const gatewayMetadata = msg.metadata?.gateway_source;
            if (gatewayMetadata?.response_sent) {
              continue; // Already sent
            }

            console.log('[Gateway] 🤖 Assistant response in thread', mapping.janThreadId, ':', {
              platform: mapping.platform,
              channel: mapping.externalId,
              content: content.substring(0, 60) + '...',
            });

            // Send response back to platform
            await sendResponseToPlatform(mapping.platform, mapping.externalId, content, msg.id);

            // Mark as sent
            await markResponseSent(mapping.janThreadId, msg.id);
          }
        }
      } catch (error) {
        // Silently skip errors - thread might not exist yet
      }
    }
  }, 3000); // Check every 3 seconds

  console.log('[Gateway] 🎧 Assistant response listener started for', gatewayThreads.length, 'threads');
}

/**
 * Extract message content from various message formats
 */
function extractMessageContent(msg: any): string | null {
  if (!msg) return null;

  // Handle array content (OpenAI format)
  if (Array.isArray(msg.content)) {
    const textContent = msg.content.find((c: any) => c.type === 'text' && c.text);
    if (textContent?.text?.value) {
      return textContent.text.value;
    }
  }

  // Handle string content
  if (typeof msg.content === 'string') {
    return msg.content;
  }

  return null;
}

/**
 * Send a response to the messaging platform
 */
async function sendResponseToPlatform(
  platform: Platform,
  channelId: string,
  content: string,
  messageId: string
): Promise<void> {
  console.log('[Gateway] 📤 Sending response to', platform, ':', channelId);

  try {
    await invoke('gateway_send_response', {
      response: {
        targetPlatform: platform,
        targetChannelId: channelId,
        content: content,
        replyTo: messageId,
        mentions: [],
      },
    });
    console.log('[Gateway] ✅ Response sent to', platform);
  } catch (error) {
    console.error('[Gateway] ❌ Failed to send response to', platform, ':', error);
    throw error;
  }
}

/**
 * Mark a response as sent in the message metadata
 */
async function markResponseSent(threadId: string, messageId: string): Promise<void> {
  try {
    await invoke('modify_message', {
      message: {
        id: messageId,
        thread_id: threadId,
        metadata: {
          gateway_source: {
            response_sent: true,
          },
        },
      },
    });
    console.log('[Gateway] ✅ Response marked as sent:', messageId);
  } catch (error) {
    console.error('[Gateway] ❌ Failed to mark response as sent:', error);
  }
}

/**
 * Inject a message into an existing Jan thread
 */
async function injectMessageIntoThread(threadId: string, message: GatewayMessage): Promise<void> {
  console.log('[Gateway] 📤 Injecting message into thread:', threadId);

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

  try {
    await invoke('create_message', { message: janMessage });
    console.log('[Gateway] ✅ Message injected into thread:', threadId);
  } catch (error) {
    console.error('[Gateway] ❌ Failed to inject message into thread:', error);
  }
}

/**
 * Create a new thread and inject the message
 */
async function createThreadAndInject(
  platform: Platform,
  channelId: string,
  message: GatewayMessage
): Promise<void> {
  console.log('[Gateway] 🆔 Creating new thread for', platform, ':', channelId);

  try {
    // Create thread
    const thread = await invoke<{ id: string }>('create_thread', {
      thread: {
        title: `${platform.toUpperCase()} - ${channelId}`,
        metadata: {
          gateway: {
            platform: platform,
            channel_id: channelId,
            user_id: message.userId,
          },
        },
      },
    });

    const threadId = thread.id;
    console.log('[Gateway] ✅ Thread created:', threadId);

    // Add thread mapping
    await invoke('gateway_add_thread_mapping', {
      platform: platform,
      externalId: channelId,
      janThreadId: threadId,
    });
    console.log('[Gateway] ✅ Thread mapping added:', platform, ':', channelId, '->', threadId);

    // Update local store
    useGatewayStore.getState().addThreadMapping(platform, channelId, threadId);

    // Inject message
    await injectMessageIntoThread(threadId, message);
    console.log('[Gateway] ✅ Message injected, waiting for AI response...');
  } catch (error) {
    console.error('[Gateway] ❌ Failed to create thread or inject message:', error);
  }
}