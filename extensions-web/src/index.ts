/**
 * Web Extensions Package
 * Contains browser-compatible extensions for Jan AI
 */

import type { WebExtensionRegistry } from './types'

export { default as AssistantExtensionWeb } from './assistant-web'
export { default as ConversationalExtensionWeb } from './conversational-web'
export { default as JanProviderWeb } from './jan-provider-web'

// Re-export types
export type { 
  WebExtensionRegistry, 
  WebExtensionModule,
  WebExtensionName,
  WebExtensionLoader,
  AssistantWebModule,
  ConversationalWebModule,
  JanProviderWebModule
} from './types'

// Extension registry for dynamic loading
export const WEB_EXTENSIONS: WebExtensionRegistry = {
  'assistant-web': () => import('./assistant-web'),
  'conversational-web': () => import('./conversational-web'),
  'jan-provider-web': () => import('./jan-provider-web'),
}