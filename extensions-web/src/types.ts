/**
 * Web Extension Types
 */

import type { AssistantExtension, ConversationalExtension } from '@janhq/core'

export interface AssistantWebModule {
  default: typeof AssistantExtension
}

export interface ConversationalWebModule {
  default: typeof ConversationalExtension
}

export type WebExtensionModule = AssistantWebModule | ConversationalWebModule

export interface WebExtensionRegistry {
  'assistant-web': () => Promise<AssistantWebModule>
  'conversational-web': () => Promise<ConversationalWebModule>
}

export type WebExtensionName = keyof WebExtensionRegistry

export type WebExtensionLoader<T extends WebExtensionName> = WebExtensionRegistry[T]

export interface IndexedDBConfig {
  dbName: string
  version: number
  stores: {
    name: string
    keyPath: string
    indexes?: { name: string; keyPath: string | string[]; unique?: boolean }[]
  }[]
}