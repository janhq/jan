/**
 * Web Extension Types
 */

import type { AssistantExtension, ConversationalExtension, BaseExtension, AIEngine } from '@janhq/core'

type ExtensionConstructorParams = ConstructorParameters<typeof BaseExtension>

export interface AssistantWebModule {
  default: new (...args: ExtensionConstructorParams) => AssistantExtension
}

export interface ConversationalWebModule {
  default: new (...args: ExtensionConstructorParams) => ConversationalExtension
}

export interface JanProviderWebModule {
  default: new (...args: ExtensionConstructorParams) => AIEngine
}

export type WebExtensionModule = AssistantWebModule | ConversationalWebModule | JanProviderWebModule

export interface WebExtensionRegistry {
  'assistant-web': () => Promise<AssistantWebModule>
  'conversational-web': () => Promise<ConversationalWebModule>
  'jan-provider-web': () => Promise<JanProviderWebModule>
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