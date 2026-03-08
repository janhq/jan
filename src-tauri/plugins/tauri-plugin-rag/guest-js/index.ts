import { invoke } from '@tauri-apps/api/core'

export async function parseDocument(filePath: string, fileType: string): Promise<string> {
  // Send both snake_case and camelCase for compatibility across runtimes/builds
  return await invoke('plugin:rag|parse_document', { filePath, fileType })
}
