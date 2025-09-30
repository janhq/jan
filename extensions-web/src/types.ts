/**
 * Web Extension Types
 */

import type { ConversationalExtension, BaseExtension, AIEngine, MCPExtension } from '@janhq/core'

type ExtensionConstructorParams = ConstructorParameters<typeof BaseExtension>

export interface ConversationalWebModule {
  default: new (...args: ExtensionConstructorParams) => ConversationalExtension
}

export interface JanProviderWebModule {
  default: new (...args: ExtensionConstructorParams) => AIEngine
}

export interface MCPWebModule {
  default: new (...args: ExtensionConstructorParams) => MCPExtension
}

export type WebExtensionModule = ConversationalWebModule | JanProviderWebModule | MCPWebModule

export interface WebExtensionRegistry {
  'conversational-web': () => Promise<ConversationalWebModule>
  'jan-provider-web': () => Promise<JanProviderWebModule>
  'mcp-web': () => Promise<MCPWebModule>
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
