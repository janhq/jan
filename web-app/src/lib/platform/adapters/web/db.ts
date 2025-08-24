/**
 * Shared IndexedDB Database for Web Extensions
 * Prevents conflicts between multiple extensions trying to initialize the same database
 */

let sharedDB: IDBDatabase | null = null
let dbInitPromise: Promise<IDBDatabase> | null = null

const DB_NAME = 'JanWebApp'
const DB_VERSION = 1

/**
 * Get shared database instance (singleton pattern)
 */
export async function getSharedDB(): Promise<IDBDatabase> {
  if (sharedDB && sharedDB.objectStoreNames.length > 0) {
    return sharedDB
  }

  if (dbInitPromise) {
    return dbInitPromise
  }

  dbInitPromise = initializeDatabase()
  return dbInitPromise
}

/**
 * Initialize the shared database with all required stores
 */
async function initializeDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create threads store for conversational extension
      if (!db.objectStoreNames.contains('threads')) {
        const threadStore = db.createObjectStore('threads', { keyPath: 'id' })
        threadStore.createIndex('updated', 'updated', { unique: false })
      }

      // Create messages store for conversational extension
      if (!db.objectStoreNames.contains('messages')) {
        const messageStore = db.createObjectStore('messages', { keyPath: 'id' })
        messageStore.createIndex('thread_id', 'thread_id', { unique: false })
        messageStore.createIndex('created_at', 'created_at', { unique: false })
      }

      // Create thread assistants store for conversational extension
      if (!db.objectStoreNames.contains('threadAssistants')) {
        db.createObjectStore('threadAssistants', { keyPath: 'thread_id' })
      }

      // Create assistants store for assistant extension
      if (!db.objectStoreNames.contains('assistants')) {
        const assistantStore = db.createObjectStore('assistants', { keyPath: 'id' })
        assistantStore.createIndex('created_at', 'created_at', { unique: false })
      }
    }

    request.onsuccess = () => {
      sharedDB = request.result
      console.log('Shared IndexedDB initialized successfully with all stores')
      resolve(sharedDB)
    }

    request.onerror = () => {
      console.error('Failed to initialize shared IndexedDB:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Close the shared database connection
 */
export function closeSharedDB(): void {
  if (sharedDB) {
    sharedDB.close()
    sharedDB = null
    dbInitPromise = null
  }
}