import { invoke } from '@tauri-apps/api/core'

export type SearchMode = 'auto' | 'ann' | 'linear'

export interface SearchResult {
  id: string
  text: string
  score?: number
  file_id: string
  chunk_file_order: number
}

export interface Status {
  ann_available: boolean
}

export interface AttachmentFileInfo {
  id: string
  name?: string
  path?: string
  type?: string
  size?: number
  chunk_count: number
}

// Events
// Events are not exported in guest-js to keep API minimal

export async function getStatus(): Promise<Status> {
  return await invoke('plugin:vector-db|get_status')
}

export async function createCollection(name: string, dimension: number): Promise<void> {
  // Use camelCase param name `dimension` to match Tauri v2 argument keys
  return await invoke('plugin:vector-db|create_collection', { name, dimension })
}

export async function createFile(
  collection: string,
  file: { path: string; name?: string; type?: string; size?: number }
): Promise<AttachmentFileInfo> {
  return await invoke('plugin:vector-db|create_file', { collection, file })
}

export async function insertChunks(
  collection: string,
  fileId: string,
  chunks: Array<{ text: string; embedding: number[] }>
): Promise<void> {
  return await invoke('plugin:vector-db|insert_chunks', { collection, fileId, chunks })
}

export async function deleteFile(
  collection: string,
  fileId: string
): Promise<void> {
  return await invoke('plugin:vector-db|delete_file', { collection, fileId })
}

export async function searchCollection(
  collection: string,
  queryEmbedding: number[],
  limit: number,
  threshold: number,
  mode?: SearchMode,
  fileIds?: string[]
): Promise<SearchResult[]> {
  return await invoke('plugin:vector-db|search_collection', {
    collection,
    queryEmbedding,
    limit,
    threshold,
    mode,
    fileIds,
  })
}

export async function deleteChunks(collection: string, ids: string[]): Promise<void> {
  return await invoke('plugin:vector-db|delete_chunks', { collection, ids })
}

export async function deleteCollection(collection: string): Promise<void> {
  return await invoke('plugin:vector-db|delete_collection', { collection })
}

export async function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<string[]> {
  // Use snake_case to match Rust command parameter names
  return await invoke('plugin:vector-db|chunk_text', { text, chunkSize, chunkOverlap })
}

export async function listAttachments(
  collection: string,
  limit?: number
): Promise<AttachmentFileInfo[]> {
  return await invoke('plugin:vector-db|list_attachments', { collection, limit })
}

export async function getChunks(
  collection: string,
  fileId: string,
  startOrder: number,
  endOrder: number
): Promise<SearchResult[]> {
  return await invoke('plugin:vector-db|get_chunks', {
    collection,
    fileId,
    startOrder,
    endOrder,
  })
}
