/**
 * Web Extensions Package
 * Contains browser-compatible extensions for Jan AI
 */

export { default as AssistantExtensionWeb } from './assistant-web'
export { default as ConversationalExtensionWeb } from './conversational-web'

// Re-export types
export type { WebExtensionRegistry } from './types'

// Extension registry for dynamic loading
export const WEB_EXTENSIONS = {
  'assistant-web': () => import('./assistant-web'),
  'conversational-web': () => import('./conversational-web'),
} as const

export type WebExtensionName = keyof typeof WEB_EXTENSIONS