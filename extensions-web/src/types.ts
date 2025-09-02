/**
 * Web Extension Types
 */

import type { AssistantExtension, ConversationalExtension, BaseExtension } from '@janhq/core'

type ExtensionConstructorParams = ConstructorParameters<typeof BaseExtension>

export interface AssistantWebModule {
  default: new (...args: ExtensionConstructorParams) => AssistantExtension
}

export interface ConversationalWebModule {
  default: new (...args: ExtensionConstructorParams) => ConversationalExtension
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