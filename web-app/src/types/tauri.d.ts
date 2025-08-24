/**
 * Tauri Plugin Types
 * Proper type definitions for Tauri API imports
 */

// Tauri Updater Plugin Types
export interface UpdateManifest {
  version: string
  date: string
  body: string
}

export interface UpdateCheckResult {
  manifest?: UpdateManifest
  shouldUpdate: boolean
  version?: string
  downloadAndInstall?: (onProgress?: (event: UpdateProgressEvent) => void) => Promise<void>
}

export interface UpdateProgressEvent {
  event: 'Started' | 'Progress' | 'Finished'
  data?: {
    contentLength?: number
    downloaded?: number
    chunkLength?: number
    [key: string]: unknown
  }
}

export interface TauriUpdater {
  check: () => Promise<UpdateCheckResult | null>
  downloadAndInstall: (onProgress?: (progress: { downloaded: number; total: number }) => void) => Promise<void>
}

// Tauri Event Types
export interface TauriEvent<T = unknown> {
  event: string
  windowLabel: string
  payload: T
  id: number
}

export interface Event<T> {
  payload: T
  id: number
  event: string
}

export interface TauriEventEmitter {
  emit: (event: string, payload?: unknown) => Promise<void>
  listen: <T = unknown>(event: string, handler: (event: Event<T>) => void) => Promise<UnlistenFn>
}

// Tauri Path Types
export interface TauriPath {
  sep: () => string
  join: (...paths: string[]) => Promise<string>
  dirname: (path: string) => Promise<string>
  basename: (path: string, ext?: string) => Promise<string>
  extname: (path: string) => Promise<string>
  isAbsolute: (path: string) => Promise<boolean>
  resolve: (...paths: string[]) => Promise<string>
}

// Tauri Deep Link Types
export type UnlistenFn = () => void

export interface TauriDeepLink {
  onOpenUrl: (handler: (urls: string[]) => void) => Promise<UnlistenFn>
  getCurrent: () => Promise<string[] | null>
}

// Tauri Dialog Types
export interface OpenDialogOptions {
  filters?: FileFilter[]
  multiple?: boolean
  directory?: boolean
  defaultPath?: string
  title?: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface TauriDialog {
  open: (options?: OpenDialogOptions) => Promise<string | string[] | null>
}

// Hardware Information Types (extending core types)
export interface SystemInformation {
  platform: string
  arch: string
  totalMemory: number
  freeMemory: number
  cpu: {
    cores: number
    model: string
  }
  gpus: Array<{
    id: string
    name: string
    total_vram: number
    free_vram: number
  }>
}

// Server Configuration Types
export interface ServerConfig {
  host: string
  port: number
  prefix: string
  apiKey: string
  trustedHosts: string[]
  isCorsEnabled: boolean
  isVerboseEnabled: boolean
}

// Tool Call Types
export interface ToolCallArgs {
  name: string
  arguments: Record<string, unknown>
  cancellationToken?: string
}

export interface ToolCallResult {
  error?: string
  content: Array<{ text: string }>
}

// MCP Server Config Types
export interface MCPServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

// Extension Types
export interface ExtensionManifest {
  name: string
  version: string
  description?: string
  author?: string
  main: string
  url: string
}

// App Configuration Update Types
export interface AppConfigurationUpdate {
  configuration: Record<string, unknown>
}

// Tauri Window Types
export interface TauriWebviewWindow {
  setTheme: (theme: 'light' | 'dark' | null) => Promise<void>
  theme: () => Promise<'light' | 'dark' | null>
  [key: string]: unknown
}

export interface TauriWindow {
  getCurrentWindow: () => TauriWebviewWindow
}

// Web API Extensions
declare global {
  interface Navigator {
    deviceMemory?: number
  }
}