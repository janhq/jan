/**
 * Window Service Types
 */

export interface WindowConfig {
  url: string
  label: string
  title?: string
  width?: number
  height?: number
  center?: boolean
  resizable?: boolean
  minimizable?: boolean
  maximizable?: boolean
  closable?: boolean
  fullscreen?: boolean
}

export interface WebviewWindowInstance {
  label: string
  close(): Promise<void>
  show(): Promise<void>
  hide(): Promise<void>
  focus(): Promise<void>
  setTitle(title: string): Promise<void>
}

export interface WindowService {
  createWebviewWindow(config: WindowConfig): Promise<WebviewWindowInstance>
  getWebviewWindowByLabel(label: string): Promise<WebviewWindowInstance | null>
  openWindow(config: WindowConfig): Promise<void>
  openLogsWindow(): Promise<void>
  openSystemMonitorWindow(): Promise<void>
  openLocalApiServerLogsWindow(): Promise<void>
}
