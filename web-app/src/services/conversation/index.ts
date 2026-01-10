/**
 * Conversation Service - Entry point
 */

export * from './types'
export { CloudConversationService } from './cloud'
export { LocalConversationService } from './local'

import { CloudConversationService } from './cloud'
import { LocalConversationService } from './local'
import type { ConversationService } from './types'

/**
 * Main conversation service factory.
 * Creates a conversation service instance bound to a specific provider.
 *
 * @param source - The data source to use ('cloud' for API, 'local' for ServiceHub)
 * @returns A conversation service instance with all operations bound to the selected provider
 *
 * @example
 * // Cloud service (API-based)
 * const cloudService = conversationService('cloud')
 * const conversations = await cloudService.getConversations()
 *
 * @example
 * // Local service (ServiceHub-based)
 * const localService = conversationService('local')
 * await localService.createConversation(payload)
 */
export const conversationService = (
  source: 'cloud' | 'local' = 'cloud'
): ConversationService => {
  if (source === 'cloud') {
    return new CloudConversationService()
  }
  return new LocalConversationService()
}

/**
 * @deprecated Use conversationService(source) instead
 * Legacy factory function for backward compatibility
 */
export const conversationProviderFactory = conversationService
