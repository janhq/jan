import type { UploadsService, UploadResult } from './types'
import type { Attachment } from '@/types/attachment'
import { ulid } from 'ulidx'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, type RAGExtension, type IngestAttachmentsResult } from '@janhq/core'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'

// Convert in slices: spreading a whole large file into String.fromCharCode
// overflows the call stack.
const BASE64_SLICE_BYTES = 0x8000

// FileReader, like the image attachment path, rather than File.arrayBuffer:
// it is available wherever attachments are read, including the test DOM.
function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

// A file on disk, read through the asset protocol like picked audio and video.
async function readLocalFile(path: string): Promise<Uint8Array> {
  const response = await fetch(convertFileSrc(path))
  if (!response.ok) {
    throw new Error(`Failed to read ${path}: ${response.status} ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_SLICE_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_SLICE_BYTES))
  }
  return btoa(binary)
}

export class DefaultUploadsService implements UploadsService {
  async saveDroppedFile(file: File): Promise<string> {
    const dataBase64 = toBase64(new Uint8Array(await readFileBytes(file)))
    return invoke<string>('save_attachment_file', { fileName: file.name, dataBase64 })
  }

  async keepAttachmentFile(path: string, fileName: string): Promise<string> {
    const dataBase64 = toBase64(await readLocalFile(path))
    return invoke<string>('save_attachment_file', { fileName, dataBase64 })
  }

  async readAttachmentAsDataUrl(path: string, mediaType: string): Promise<string> {
    return `data:${mediaType};base64,${toBase64(await readLocalFile(path))}`
  }

  async ingestImage(_threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'image') throw new Error('ingestImage: attachment is not image')
    // Placeholder upload flow; swap for real API call when backend is ready
    await new Promise((r) => setTimeout(r, 100))
    return { id: ulid() }
  }

  async ingestFileAttachment(threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document') throw new Error('ingestFileAttachment: attachment is not document')
    const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
    if (!ext?.ingestAttachments) throw new Error('RAG extension not available')
    const res: IngestAttachmentsResult = await ext.ingestAttachments(threadId, [
      { path: attachment.path!, name: attachment.name, type: attachment.fileType, size: attachment.size },
    ])
    const files = res.files
    if (Array.isArray(files) && files[0]?.id) {
      return {
        id: files[0].id,
        size: typeof files[0].size === 'number' ? Number(files[0].size) : undefined,
        chunkCount: typeof files[0].chunk_count === 'number' ? Number(files[0].chunk_count) : undefined,
      }
    }
    throw new Error('Failed to resolve ingested attachment id')
  }

  async ingestFileAttachmentForProject(projectId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document') throw new Error('ingestFileAttachmentForProject: attachment is not document')
    const ext = ExtensionManager.getInstance().get<RAGExtension>(ExtensionTypeEnum.RAG)
    if (!ext?.ingestAttachmentsForProject) throw new Error('RAG extension does not support project-level ingestion')
    const res: IngestAttachmentsResult = await ext.ingestAttachmentsForProject(projectId, [
      { path: attachment.path!, name: attachment.name, type: attachment.fileType, size: attachment.size },
    ])
    const files = res.files
    if (Array.isArray(files) && files[0]?.id) {
      return {
        id: files[0].id,
        size: typeof files[0].size === 'number' ? Number(files[0].size) : undefined,
        chunkCount: typeof files[0].chunk_count === 'number' ? Number(files[0].chunk_count) : undefined,
      }
    }
    throw new Error('Failed to resolve ingested attachment id')
  }
}
