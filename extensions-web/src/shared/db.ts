/**
 * Shared IndexedDB utilities for web extensions
 */

import type { IndexedDBConfig } from '../types'

/**
 * Default database configuration for Jan web extensions
 */
const DEFAULT_DB_CONFIG: IndexedDBConfig = {
  dbName: 'jan-web-db',
  version: 1,
  stores: [
    {
      name: 'assistants',
      keyPath: 'id',
      indexes: [
        { name: 'name', keyPath: 'name' },
        { name: 'created_at', keyPath: 'created_at' }
      ]
    },
    {
      name: 'threads',
      keyPath: 'id',
      indexes: [
        { name: 'title', keyPath: 'title' },
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'updated_at', keyPath: 'updated_at' }
      ]
    },
    {
      name: 'messages',
      keyPath: 'id',
      indexes: [
        { name: 'thread_id', keyPath: 'thread_id' },
        { name: 'created_at', keyPath: 'created_at' }
      ]
    }
  ]
}

/**
 * Shared IndexedDB instance
 */
let sharedDB: IDBDatabase | null = null

/**
 * Get or create the shared IndexedDB instance
 */
export const getSharedDB = async (config: IndexedDBConfig = DEFAULT_DB_CONFIG): Promise<IDBDatabase> => {
  if (sharedDB && sharedDB.name === config.dbName) {
    return sharedDB
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(config.dbName, config.version)

    request.onerror = () => {
      reject(new Error(`Failed to open database: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      sharedDB = request.result
      resolve(sharedDB)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      // Create object stores
      for (const store of config.stores) {
        let objectStore: IDBObjectStore
        
        if (db.objectStoreNames.contains(store.name)) {
          // Store exists, might need to update indexes
          continue
        } else {
          // Create new store
          objectStore = db.createObjectStore(store.name, { keyPath: store.keyPath })
        }

        // Create indexes
        if (store.indexes) {
          for (const index of store.indexes) {
            try {
              objectStore.createIndex(index.name, index.keyPath, { unique: index.unique || false })
            } catch (error) {
              // Index might already exist, ignore
            }
          }
        }
      }
    }
  })
}

/**
 * Close the shared database connection
 */
export const closeSharedDB = () => {
  if (sharedDB) {
    sharedDB.close()
    sharedDB = null
  }
}