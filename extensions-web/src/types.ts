/**
 * Web Extension Types
 */

import type { ConversationalExtension, BaseExtension, AIEngine, MCPExtension, ProjectExtension } from '@janhq/core'

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

export interface ProjectWebModule {
  default: new (...args: ExtensionConstructorParams) => ProjectExtension
}

export type WebExtensionModule = ConversationalWebModule | JanProviderWebModule | MCPWebModule | ProjectWebModule

export interface WebExtensionRegistry {
  'conversational-web': () => Promise<ConversationalWebModule>
  'jan-provider-web': () => Promise<JanProviderWebModule>
  'mcp-web': () => Promise<MCPWebModule>
  'project-web': () => Promise<ProjectWebModule>
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
