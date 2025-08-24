/**
 * Web API Adapter
 * Implements window.core.api for browser environment
 * Uses IndexedDB for storage and localStorage for settings
 */

import { AppConfiguration, Thread, ThreadMessage, ThreadAssistantInfo } from '@janhq/core'
import type { ExtensionManifest, ServerConfig } from '@/types/tauri'

export class WebAPIAdapter {
  private virtualFS: Map<string, string> = new Map()

  constructor() {
    // Initialize virtual file system from localStorage if exists
    this.loadVirtualFS()
  }

  private loadVirtualFS() {
    try {
      const stored = localStorage.getItem('jan_virtual_fs')
      if (stored) {
        const entries = JSON.parse(stored)
        this.virtualFS = new Map(entries)
      }
    } catch (error) {
      console.error('Failed to load virtual FS:', error)
    }
  }

  private saveVirtualFS() {
    try {
      const entries = Array.from(this.virtualFS.entries())
      localStorage.setItem('jan_virtual_fs', JSON.stringify(entries))
    } catch (error) {
      console.error('Failed to save virtual FS:', error)
    }
  }

  // File system operations (virtual implementation)
  async writeFileSync({ args }: { args: [string, string | object] }): Promise<void> {
    const [path, content] = args
    this.virtualFS.set(path, typeof content === 'string' ? content : JSON.stringify(content))
    this.saveVirtualFS()
  }

  async readFileSync({ args }: { args: [string] }): Promise<string> {
    const [path] = args
    return this.virtualFS.get(path) || ''
  }

  async existsSync({ args }: { args: [string] }): Promise<boolean> {
    const [path] = args
    return this.virtualFS.has(path)
  }

  async mkdir({ args }: { args: [string] }): Promise<void> {
    const [path] = args
    // In virtual FS, just mark directory as existing
    this.virtualFS.set(path, '__DIRECTORY__')
    this.saveVirtualFS()
  }

  async rm({ args }: { args: [string] }): Promise<void> {
    const [path] = args
    // Remove path and all children
    const pathsToDelete = Array.from(this.virtualFS.keys()).filter(key => 
      key === path || key.startsWith(path + '/')
    )
    pathsToDelete.forEach(p => this.virtualFS.delete(p))
    this.saveVirtualFS()
  }

  async readdirSync({ args }: { args: [string] }): Promise<string[]> {
    const [path] = args
    const prefix = path.endsWith('/') ? path : path + '/'
    
    // Get all paths that start with prefix
    const children = new Set<string>()
    this.virtualFS.forEach((_, key) => {
      if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) children.add(firstPart)
      }
    })
    
    return Array.from(children)
  }

  async unlinkSync(path: string): Promise<void> {
    this.virtualFS.delete(path)
    this.saveVirtualFS()
  }

  async appendFileSync(path: string, content: string): Promise<void> {
    const existing = this.virtualFS.get(path) || ''
    this.virtualFS.set(path, existing + content)
    this.saveVirtualFS()
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = this.virtualFS.get(src)
    if (content) {
      this.virtualFS.set(dest, content)
      this.saveVirtualFS()
    }
  }

  // Path operations
  async joinPath({ args }: { args: string[] }): Promise<string> {
    return args.filter(Boolean).join('/')
  }

  async baseName(path: string): Promise<string> {
    return path.split('/').pop() || ''
  }

  async dirName(path: string): Promise<string> {
    const parts = path.split('/')
    parts.pop()
    return parts.join('/') || '/'
  }

  // Jan specific operations
  async getJanDataFolderPath(): Promise<string> {
    return 'jan-data' // Virtual path
  }

  async getUserHomePath(): Promise<string> {
    return 'home' // Virtual path
  }

  async getResourcePath(): Promise<string> {
    return 'resources' // Virtual path
  }

  async openFileExplorer({ path }: { path: string }): Promise<void> {
    console.log('File explorer not available in web version:', path)
  }

  async openExternalUrl(url: string): Promise<void> {
    window.open(url, '_blank')
  }

  async isSubdirectory(from: string, to: string): Promise<boolean> {
    return to.startsWith(from + '/')
  }

  async log(message: string, fileName?: string): Promise<void> {
    console.log(`[${fileName || 'app'}]`, message)
    return Promise.resolve()
  }

  async showToast(title: string, message: string): Promise<void> {
    console.log(`Toast: ${title} - ${message}`)
    // Could integrate with a toast library if available
    return Promise.resolve()
  }

  // App configuration
  async getAppConfigurations(): Promise<AppConfiguration> {
    try {
      const stored = localStorage.getItem('jan_app_config')
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.warn('Failed to access localStorage for app configuration:', error)
    }
    
    return {
      data_folder: 'jan-data',
      quick_ask: false,
    }
  }

  async updateAppConfiguration(update: Partial<AppConfiguration>): Promise<void> {
    try {
      const config = await this.getAppConfigurations()
      const updated = { ...config, ...update }
      localStorage.setItem('jan_app_config', JSON.stringify(updated))
    } catch (error) {
      console.warn('Failed to update app configuration in localStorage:', error)
      // Configuration updates will be lost but app continues to function
    }
  }

  async changeAppDataFolder({ newDataFolder }: { newDataFolder: string }): Promise<void> {
    await this.updateAppConfiguration({ data_folder: newDataFolder })
  }

  // Extension operations (return empty/mock data for web)
  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    // Web extensions are bundled, not dynamically loaded
    return []
  }

  async installExtension({ extensions }: { extensions: ExtensionManifest[] }): Promise<ExtensionManifest[]> {
    // extensions parameter unused in web version
    void extensions
    console.warn('Extension installation not supported in web version')
    return []
  }

  async uninstallExtension({ extensions, reload }: { extensions: string[], reload: boolean }): Promise<boolean> {
    // extensions and reload parameters unused in web version
    void extensions
    void reload
    console.warn('Extension uninstallation not supported in web version')
    return false
  }

  // Thread operations (handled by conversational extension)
  async listThreads(): Promise<Thread[]> {
    // This will be overridden by conversational extension
    return []
  }

  async createThread({ thread }: { thread: Thread }): Promise<Thread> {
    // This will be overridden by conversational extension
    return thread
  }

  async modifyThread({ thread }: { thread: Thread }): Promise<void> {
    // thread parameter unused - overridden by conversational extension
    void thread
    // This will be overridden by conversational extension
  }

  async deleteThread({ threadId }: { threadId: string }): Promise<void> {
    // threadId parameter unused - overridden by conversational extension
    void threadId
    // This will be overridden by conversational extension
  }

  // Message operations (handled by conversational extension)
  async listMessages({ threadId }: { threadId: string }): Promise<ThreadMessage[]> {
    // threadId parameter unused - overridden by conversational extension
    void threadId
    // This will be overridden by conversational extension
    return []
  }

  async createMessage({ message }: { message: ThreadMessage }): Promise<ThreadMessage> {
    // This will be overridden by conversational extension
    return message
  }

  async modifyMessage({ message }: { message: ThreadMessage }): Promise<ThreadMessage> {
    // This will be overridden by conversational extension
    return message
  }

  async deleteMessage({ threadId, messageId }: { threadId: string, messageId: string }): Promise<void> {
    // threadId and messageId parameters unused - overridden by conversational extension
    void threadId
    void messageId
    // This will be overridden by conversational extension
  }

  // Thread assistant operations
  async getThreadAssistant({ threadId }: { threadId: string }): Promise<ThreadAssistantInfo | null> {
    // threadId parameter unused - overridden by conversational extension
    void threadId
    // This will be overridden by conversational extension
    return null
  }

  async createThreadAssistant(_threadId: string, assistant: ThreadAssistantInfo): Promise<ThreadAssistantInfo> {
    // This will be overridden by conversational extension
    return assistant
  }

  async modifyThreadAssistant({ threadId, assistant }: { threadId: string, assistant: ThreadAssistantInfo }): Promise<ThreadAssistantInfo> {
    // threadId parameter unused - overridden by conversational extension
    void threadId
    // This will be overridden by conversational extension
    return assistant
  }

  // Other operations that don't apply to web
  async factoryReset(): Promise<void> {
    localStorage.clear()
    this.virtualFS.clear()
    // Clear IndexedDB
    if ('indexedDB' in window) {
      const databases = await indexedDB.databases()
      await Promise.all(
        databases.map(db => {
          if (db.name) {
            const deleteReq = indexedDB.deleteDatabase(db.name)
            return new Promise((resolve, reject) => {
              deleteReq.onsuccess = () => resolve(undefined)
              deleteReq.onerror = () => reject(deleteReq.error)
            })
          }
          return Promise.resolve()
        })
      )
    }
    window.location.reload()
  }

  async readLogs(): Promise<string> {
    return '' // No logs in web version
  }

  async relaunch(): Promise<void> {
    window.location.reload()
  }

  // Tools/MCP operations (not supported in web)
  async getTools(): Promise<unknown[]> {
    return []
  }

  async callTool(args: Record<string, unknown>): Promise<unknown> {
    // args parameter unused in web version
    void args
    console.warn('Tool calling not supported in web version')
    return null
  }

  async cancelToolCall(args: Record<string, unknown>): Promise<void> {
    // args parameter unused in web version
    void args
    console.warn('Tool cancellation not supported in web version')
    return Promise.resolve()
  }

  async saveMcpConfigs(args: Record<string, unknown>): Promise<void> {
    // args parameter unused in web version
    void args
    console.warn('MCP not supported in web version')
    return Promise.resolve()
  }

  async getMcpConfigs(): Promise<Record<string, unknown>> {
    return {}
  }

  async restartMcpServers(): Promise<void> {
    console.warn('MCP not supported in web version')
    return Promise.resolve()
  }

  async getConnectedServers(): Promise<string[]> {
    return []
  }

  // Install extensions (no-op for web)
  async installExtensions(): Promise<void> {
    // Extensions are pre-bundled in web version
    return Promise.resolve()
  }

  // GGUF files (not applicable for web)
  async getGgufFiles(paths: string[]): Promise<{ ggufFiles: unknown[]; nonGgufFiles: unknown[] }> {
    // paths parameter unused in web version
    void paths
    return { ggufFiles: [], nonGgufFiles: [] }
  }

  // File stats (virtual implementation)
  async fileStat(path: string, outsideJanDataFolder?: boolean): Promise<{ size: number; isDirectory: boolean; createdAt: number; modifiedAt: number } | null> {
    // outsideJanDataFolder parameter unused in virtual FS implementation
    void outsideJanDataFolder
    const exists = this.virtualFS.has(path)
    if (!exists) return null
    
    const content = this.virtualFS.get(path)
    return {
      size: content?.length || 0,
      isDirectory: content === '__DIRECTORY__',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    }
  }

  // Blob operations (use virtual FS)
  async writeBlob(path: string, data: string): Promise<void> {
    this.virtualFS.set(path, data)
    this.saveVirtualFS()
  }

  // Local API Server operations (not applicable for web)
  async startServer(config: ServerConfig): Promise<void> {
    // config parameter unused in web version
    void config
    console.warn('Local API server not supported in web version')
    return Promise.resolve()
  }

  async stopServer(): Promise<void> {
    console.warn('Local API server not supported in web version')
    return Promise.resolve()
  }

  // Hardware monitoring operations (mock for web)
  async getSystemInfo(): Promise<{ platform: string; arch: string; totalMemory: number; freeMemory: number; cpu: { cores: number; model: string }; gpus: unknown[] }> {
    return {
      platform: 'web',
      arch: 'unknown',
      totalMemory: navigator.deviceMemory ? navigator.deviceMemory * 1024 * 1024 * 1024 : 4 * 1024 * 1024 * 1024,
      freeMemory: navigator.deviceMemory ? navigator.deviceMemory * 0.5 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024,
      cpu: {
        cores: navigator.hardwareConcurrency || 4,
        model: 'Unknown CPU',
      },
      gpus: []
    }
  }

  // Model operations (delegated to extensions in web version)
  async startModel(): Promise<void> {
    console.warn('Local model inference not supported in web version')
    return Promise.resolve()
  }

  async stopModel(): Promise<void> {
    console.warn('Local model inference not supported in web version')
    return Promise.resolve()
  }

  async getModels(): Promise<unknown[]> {
    // Models are managed by provider extensions
    return []
  }

  // Download operations (not supported in web)
  async downloadModel(): Promise<void> {
    console.warn('Model download not supported in web version')
    return Promise.resolve()
  }

  async cancelDownload(): Promise<void> {
    console.warn('Download cancellation not supported in web version')
    return Promise.resolve()
  }
}