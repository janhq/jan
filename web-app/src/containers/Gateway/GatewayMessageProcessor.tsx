/**
 * Gateway Message Processor
 *
 * This component activates the gateway message processing pipeline.
 * It handles:
 * 1. Incoming messages from messaging platforms → Jan threads
 * 2. Assistant responses → back to messaging platforms
 */

import { useEffect, useCallback, useRef } from 'react'
import { useGatewayEvents } from '../../hooks/useGatewayEvents'
import { useIsGatewayRunning, useGatewayStore } from '../../hooks/useGateway'
import { useMessages } from '../../hooks/useMessages'
import { useThreads } from '../../hooks/useThreads'
import type { GatewayMessage, Platform } from '../../services/gateway'
import type { ThreadMessage } from '@janhq/core'

interface GatewayMessageProcessorProps {
  /** Called when a new thread is created for a gateway message */
  onThreadCreated?: (threadId: string, message: GatewayMessage) => void
  /** Called when a message is injected into an existing thread */
  onMessageInjected?: (threadId: string, message: GatewayMessage) => void
}

/**
 * Extract text content from a ThreadMessage
 */
function extractTextContent(message: ThreadMessage): string {
  if (!message.content || !Array.isArray(message.content)) {
    return ''
  }

  return message.content
    .filter((part) => part.type === 'text' && part.text?.value)
    .map((part) => part.text?.value || '')
    .join('\n')
}

export function GatewayMessageProcessor({
  onThreadCreated,
  onMessageInjected,
}: GatewayMessageProcessorProps) {
  // These are available for future use but not currently needed
  console.log('[GatewayMessageProcessor] Props available:', {
    onThreadCreatedDefined: !!onThreadCreated,
    onMessageInjectedDefined: !!onMessageInjected,
  })
  const isRunning = useIsGatewayRunning()
  const sendResponse = useGatewayStore((state) => state.sendResponse)
  const threads = useThreads((state) => state.threads)
  const allMessages = useMessages((state) => state.messages)

  // Track which assistant messages we've already sent responses for
  const sentResponsesRef = useRef<Set<string>>(new Set())

  const handleStatusChange = useCallback((running: boolean) => {
    console.log('[GatewayMessageProcessor] Status changed:', running)
  }, [])

  // Use the gateway events hook to process incoming messages
  useGatewayEvents({
    onStatusChange: handleStatusChange,
  })

  // Watch for new assistant messages and send responses back to gateway
  useEffect(() => {
    console.log('[GatewayMessageProcessor] Checking for assistant messages, isRunning:', isRunning);
    console.log('[GatewayMessageProcessor] Total threads:', Object.keys(threads).length);
    console.log('[GatewayMessageProcessor] Total messages:', Object.keys(allMessages).length);

    if (!isRunning) {
      console.log('[GatewayMessageProcessor] Gateway not running, skipping');
      return;
    }

    let foundGatewayThreads = 0;
    let foundAssistantMessages = 0;

    // Check all threads for gateway metadata and new assistant messages
    for (const [threadId, threadMessages] of Object.entries(allMessages)) {
      const thread = threads[threadId];
      if (!thread) {
        console.log('[GatewayMessageProcessor] No thread found for:', threadId);
        continue;
      }

      console.log('[GatewayMessageProcessor] Checking thread:', threadId, {
        hasMetadata: !!thread.metadata,
        metadata: thread.metadata,
      });

      // Check if this thread is connected to a gateway
      const gatewayMeta = thread.metadata?.gateway as {
        platform?: Platform
        channel_id?: string
      } | undefined

      if (!gatewayMeta?.platform || !gatewayMeta?.channel_id) {
        console.log('[GatewayMessageProcessor] Thread', threadId, 'has no gateway metadata');
        continue;
      }

      foundGatewayThreads++;
      console.log('[GatewayMessageProcessor] Found gateway thread:', threadId, {
        platform: gatewayMeta.platform,
        channel: gatewayMeta.channel_id,
      });

      // Find assistant messages that haven't been sent yet
      for (const message of threadMessages) {
        console.log('[GatewayMessageProcessor] Message:', message.id, 'role:', message.role);

        if (message.role !== 'assistant') continue
        foundAssistantMessages++;

        if (sentResponsesRef.current.has(message.id)) {
          console.log('[GatewayMessageProcessor] Already sent response for:', message.id);
          continue;
        }

        // Check if message is complete (has content and status is ready)
        const textContent = extractTextContent(message)
        console.log('[GatewayMessageProcessor] Assistant message content:', textContent?.substring(0, 50), 'status:', message.status);

        if (!textContent || message.status !== 'ready') {
          console.log('[GatewayMessageProcessor] Message not ready, skipping');
          continue;
        }

        // Mark as sent to prevent duplicates
        sentResponsesRef.current.add(message.id)

        console.log(
          '[GatewayMessageProcessor] ✅ Sending response to',
          gatewayMeta.platform,
          'channel',
          gatewayMeta.channel_id,
          'message:',
          message.id
        )

        // Send response back to gateway
        sendResponse(gatewayMeta.channel_id, textContent).catch((error) => {
          console.error('[GatewayMessageProcessor] Failed to send response:', error)
          // Remove from sent set so it can be retried
          sentResponsesRef.current.delete(message.id)
        })
      }
    }

    console.log('[GatewayMessageProcessor] Summary:', {
      gatewayThreads: foundGatewayThreads,
      assistantMessages: foundAssistantMessages,
    });
  }, [isRunning, allMessages, threads, sendResponse])

  // Log when processor becomes active
  useEffect(() => {
    if (isRunning) {
      console.log('[GatewayMessageProcessor] Message processing active')
    } else {
      console.log('[GatewayMessageProcessor] Message processing inactive (gateway not running)')
    }
  }, [isRunning])

  // This component doesn't render anything visible
  return null
}

export default GatewayMessageProcessor
