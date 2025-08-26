/**
 * Web Extension Types
 */

export interface WebExtensionRegistry {
  'assistant-web': () => Promise<any>
  'conversational-web': () => Promise<any>
}

export interface IndexedDBConfig {
  dbName: string
  version: number
  stores: {
    name: string
    keyPath: string
    indexes?: { name: string; keyPath: string | string[]; unique?: boolean }[]
  }[]
}