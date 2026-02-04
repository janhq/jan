/**
 * Gateway state management with Zustand
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { streamText, type UIMessage, type LanguageModel } from 'ai';
import type {
  GatewayConfig,
  GatewayStatus,
  GatewayMessage,
  ConnectionState,
  ThreadMapping,
  Platform,
} from '../services/gateway';
import type { ThreadMessage } from '@janhq/core';
import { createGatewayService } from '../services/gateway';
import { ModelFactory } from '@/lib/model-factory';
import { useModelProvider } from '@/hooks/useModelProvider';

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

  // Gateway inference state
  gatewayInferenceInProgress: Map<string, boolean>;

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

  // Discord bot management
  startDiscordBot: (botToken: string, botUserId: string, channelId: string) => Promise<void>;
  stopDiscordBot: () => Promise<void>;
  fetchDiscordBotStatus: () => Promise<void>;
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
    gatewayInferenceInProgress: new Map(),
    isLoading: false,
    error: null,
    discordBotStatus: null,

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

    // Discord bot actions
    startDiscordBot: async (botToken: string, botUserId: string, channelId: string) => {
      set({ isLoading: true, error: null });
      try {
        await invoke('gateway_start_discord_bot', {
          botToken,
          botUserId,
          channelId,
        });
        set({ isLoading: false });
        get().fetchDiscordBotStatus();
      } catch (error) {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to start Discord bot',
        });
      }
    },

    stopDiscordBot: async () => {
      set({ isLoading: true, error: null });
      try {
        await invoke('gateway_stop_discord_bot');
        set({ isLoading: false, discordBotStatus: null });
      } catch (error) {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to stop Discord bot',
        });
      }
    },

    fetchDiscordBotStatus: async () => {
      try {
        const status = await invoke<{
          configured: boolean;
          active: boolean;
          running: boolean;
          channelId: string | null;
        }>('gateway_get_discord_bot_status');
        set({ discordBotStatus: status });
      } catch (error) {
        console.error('Failed to fetch Discord bot status:', error);
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

export const useDiscordBotStatus = () =>
  useGatewayStore((state) => state.discordBotStatus);

// Initialize event listeners
if (typeof window !== 'undefined') {
  console.log('[Gateway] 🚀 Initializing gateway event listeners...');

  // Always listen for gateway events - status changes will trigger listener setup
  const platforms: Platform[] = ['discord', 'slack', 'telegram'];
  console.log('[Gateway] 🚀 Listening for platforms:', platforms);

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
      console.log('[Gateway] 📨 [FLOW-1] RECEIVED', platform, 'message:', {
        id: message.id,
        user: message.userId,
        channel: message.channelId,
        content: message.content.substring(0, 80) + (message.content.length > 80 ? '...' : ''),
      });

      // Add to store
      useGatewayStore.getState().addMessage(message);
      console.log('[Gateway] 📝 [FLOW-1] Message added to store');

      // Check for existing thread mapping
      const threadMappings = useGatewayStore.getState().threadMappings;
      console.log('[Gateway] 🔍 [FLOW-1] Thread mappings:', threadMappings.length);

      const existingMapping = threadMappings.find(
        (m) => m.platform === platform && m.externalId === message.channelId
      );

      if (existingMapping) {
        console.log('[Gateway] 🔗 [FLOW-2] Found existing thread mapping:', existingMapping.janThreadId);
        // Inject message into existing thread
        await injectMessageIntoThread(existingMapping.janThreadId, message);
      } else {
        console.log('[Gateway] 🆕 [FLOW-3] No thread mapping for', platform, ':', message.channelId);
        // Create new thread
        await createThreadAndInject(platform, message.channelId, message);
      }
    })
  );

  // Listen for assistant responses in gateway threads and send back to platform
  console.log('[Gateway] 🎧 Setting up assistant response listener...');
  setupAssistantResponseListener();

  // Initial status fetch
  useGatewayStore.getState().fetchStatus();
}

/**
 * Listen for assistant messages in gateway threads and send them back to platforms
 */
async function setupAssistantResponseListener() {
  console.log('[Gateway] 🎧 setupAssistantResponseListener called');

  // Poll for new messages in gateway threads
  const gatewayThreads = useGatewayStore.getState().threadMappings;
  console.log('[Gateway] 🎧 Gateway threads found:', gatewayThreads.length);

  if (gatewayThreads.length === 0) {
    console.log('[Gateway] ⚠️ No gateway threads to monitor for responses');
    return;
  }

  // Log all threads we're monitoring
  gatewayThreads.forEach((t, i) => {
    console.log(`[Gateway] 🎧 Thread ${i + 1}: ${t.platform}:${t.externalId} -> ${t.janThreadId}`);
  });

  // Set up polling to check for assistant responses
  setInterval(async () => {
    console.log('[Gateway] 🔄 Polling for assistant responses...');
    const currentMappings = useGatewayStore.getState().threadMappings;
    console.log('[Gateway] 🔄 Current mappings:', currentMappings.length);

    for (const mapping of currentMappings) {
      console.log('[Gateway] 🔄 Checking thread:', mapping.janThreadId);
      // Get latest messages from this thread (silently skip errors)
      const messages = await invoke<ThreadMessage[]>('list_messages', { threadId: mapping.janThreadId }).catch(() => null);

      if (messages && messages.length > 0) {
        // Find the most recent assistant message that hasn't been sent yet
        const recentMessages = messages.slice(-5); // Check last 5 messages

        for (const msg of recentMessages) {
          const role = msg.role;
          const content = extractMessageContent(msg);

          // Skip if not an assistant message or already sent
          if (role !== 'assistant' || !content) continue;

          // Check if this is a gateway thread and hasn't been responded
          const gatewayMetadata = msg.metadata?.gateway_source as { response_sent?: boolean } | undefined;
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
    }
  }, 3000); // Check every 3 seconds

  console.log('[Gateway] 🎧 Assistant response listener started for', gatewayThreads.length, 'threads');
}

/**
 * Extract message content from various message formats
 */
function extractMessageContent(msg: ThreadMessage): string | null {
  if (!msg) return null;

  // Handle array content (OpenAI format)
  if (Array.isArray(msg.content)) {
    const textContent = msg.content.find((c) => c.type === 'text' && c.text);
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
 * Get the default model for gateway inference
 * Uses the currently selected model from useModelProvider
 */
async function getDefaultGatewayModel(): Promise<LanguageModel | null> {
  const { selectedModel, selectedProvider } = useModelProvider.getState();

  if (!selectedModel) {
    console.error('[Gateway] ❌ No model selected for gateway inference');
    return null;
  }

  const provider = useModelProvider.getState().getProviderByName(selectedProvider);
  if (!provider) {
    console.error('[Gateway] ❌ No provider found for:', selectedProvider);
    return null;
  }

  try {
    const model = await ModelFactory.createModel(selectedModel.id, provider);
    console.log('[Gateway] ✅ [FLOW-6] Gateway model loaded:', selectedModel.id);
    return model;
  } catch (error) {
    console.error('[Gateway] ❌ Failed to create model for gateway:', error);
    return null;
  }
}

/**
 * Trigger LLM inference for a gateway message
 * This is the core function that makes gateway messages trigger AI responses
 */
async function triggerGatewayInference(
  threadId: string,
  userMessage: string,
  platform: string,
  channelId: string
): Promise<void> {
  console.log('[Gateway] 🤖 [FLOW-6] Starting inference for', platform, 'message in thread:', threadId);

  // Check if inference is already in progress for this thread
  const state = useGatewayStore.getState();
  if (state.gatewayInferenceInProgress.get(threadId)) {
    console.log('[Gateway] ⚠️ Inference already in progress for thread:', threadId);
    return;
  }

  // Mark inference as in progress
  useGatewayStore.setState({
    gatewayInferenceInProgress: new Map(state.gatewayInferenceInProgress).set(threadId, true),
  });

  try {
    // Get the default model
    const model = await getDefaultGatewayModel();
    if (!model) {
      console.error('[Gateway] ❌ [FLOW-6] No model available for inference');
      return;
    }

    // Convert gateway message to model message format
    const modelMessages: UIMessage[] = [
      {
        id: `gateway-${Date.now()}`,
        role: 'user',
        content: userMessage,
        parts: [
          {
            type: 'text',
            text: { value: userMessage },
          },
        ],
        createdAt: new Date(),
      },
    ];

    // System prompt for the gateway assistant
    const systemMessage = `You are Jan, an AI assistant. You are conversing via ${platform}. Respond helpfully and concisely.`;

    console.log('[Gateway] 📡 [FLOW-7] Calling streamText for gateway inference...');

    // Call streamText directly (same as CustomChatTransport.sendMessages)
    const result = await streamText({
      model,
      messages: modelMessages,
      system: systemMessage,
    });

    // Collect the full response
    let fullResponse = '';
    const reader = result.textStream.getReader();
    const decoder = new TextDecoder();

    console.log('[Gateway] 📥 [FLOW-7] Receiving response stream...');

    let chunks = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = typeof value === 'string' ? value : decoder.decode(value);
      fullResponse += chunk;
      chunks++;
      // Log chunks for debugging (browser doesn't have process.stdout)
      if (chunks <= 3) {
        console.log('[Gateway] 📥 [FLOW-7] Chunk', chunks, ':', chunk.substring(0, 50));
      }
    }

    console.log('[Gateway] 📝 [FLOW-8] ===========================================');
    console.log('[Gateway] 📝 [FLOW-8] LLM INFERENCE COMPLETE');
    console.log('[Gateway] 📝 [FLOW-8] ===========================================');
    console.log('[Gateway] 📝 [FLOW-8] Chunks received:', chunks);
    console.log('[Gateway] 📝 [FLOW-8] Response length:', fullResponse.length, 'chars');
    console.log('[Gateway] 📝 [FLOW-8] Response preview:', fullResponse.substring(0, 200) + (fullResponse.length > 200 ? '...' : ''));
    console.log('[Gateway] 📝 [FLOW-8] Platform:', platform, '| Channel:', channelId);
    console.log('[Gateway] 📝 [FLOW-8] Thread ID:', threadId);

    if (fullResponse.trim()) {
      // Send response back to platform
      console.log('[Gateway] 📤 [FLOW-8] Calling sendResponseToPlatform...');
      console.log('[Gateway] 📤 [FLOW-8] Content to send:', fullResponse.substring(0, 100) + '...');
      await sendResponseToPlatform(platform, channelId, fullResponse, '');
      console.log('[Gateway] ✅ [FLOW-8] sendResponseToPlatform completed');
    } else {
      console.log('[Gateway] ⚠️ [FLOW-8] Empty response from model, not sending');
    }
  } catch (error) {
    console.error('[Gateway] ❌ [FLOW-6] Inference error:', error);
  } finally {
    // Clear inference in progress flag
    const state = useGatewayStore.getState();
    useGatewayStore.setState({
      gatewayInferenceInProgress: new Map(state.gatewayInferenceInProgress).set(threadId, false),
    });
  }
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
  console.log('[Gateway] 📤 [FLOW-8] Sending response to', platform, ':', channelId);
  console.log('[Gateway] 📤 [FLOW-8] Response preview:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));

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
    console.log('[Gateway] ✅ [FLOW-8] Response sent to', platform);
  } catch (error) {
    console.error('[Gateway] ❌ [FLOW-8] Failed to send response to', platform, ':', error);
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
  console.log('[Gateway] 📤 [FLOW-5] Injecting message into thread:', threadId);

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
    console.log('[Gateway] ✅ [FLOW-5] Message injected into thread:', threadId);

    // Trigger LLM inference for the gateway message
    console.log('[Gateway] 🤖 [FLOW-6] Triggering inference after message injection...');
    await triggerGatewayInference(
      threadId,
      message.content,
      message.platform,
      message.channelId
    );
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
  console.log('[Gateway] 🆔 [FLOW-4] Creating new thread for', platform, ':', channelId);

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
    console.log('[Gateway] ✅ [FLOW-4] Thread created:', threadId);

    // Add thread mapping
    await invoke('gateway_add_thread_mapping', {
      platform: platform,
      externalId: channelId,
      janThreadId: threadId,
    });
    console.log('[Gateway] ✅ [FLOW-4] Thread mapping added:', platform, ':', channelId, '->', threadId);

    // Update local store
    useGatewayStore.getState().addThreadMapping(platform, channelId, threadId);

    // Inject message
    console.log('[Gateway] 📤 [FLOW-5] Injecting gateway message into thread...');
    await injectMessageIntoThread(threadId, message);
    console.log('[Gateway] ✅ [FLOW-5] Message injected, inference triggered');
  } catch (error) {
    console.error('[Gateway] ❌ Failed to create thread or inject message:', error);
  }
}