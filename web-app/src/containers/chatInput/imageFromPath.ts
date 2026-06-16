import { convertFileSrc } from '@tauri-apps/api/core'
import { fs } from '@janhq/core'

import { Attachment, createImageAttachment } from '@/types/attachment'

const mimeTypeFromExtension = (name: string): string => {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    default:
      return ''
  }
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
      } else {
        reject(new Error('FileReader did not return a string'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })

/**
 * Read an image file by its filesystem path (Tauri only) and produce an
 * Attachment compatible with the existing image ingestion pipeline.
 *
 * Uses Tauri's asset protocol via `convertFileSrc`, which is enabled with a
 * permissive scope in `src-tauri/tauri.conf.json`. CSP `connect-src` already
 * allows `http://asset.localhost`, so `fetch()` against the converted URL
 * works without additional configuration.
 */
export const readImageAttachmentFromPath = async (
  path: string
): Promise<Attachment> => {
  const name = path.split(/[\\/]/).pop() || path

  const url = convertFileSrc(path)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to read image (${response.status} ${response.statusText})`
    )
  }
  const blob = await response.blob()
  const dataUrl = await blobToDataUrl(blob)
  const base64 = dataUrl.split(',')[1] ?? ''

  const mimeType = blob.type || mimeTypeFromExtension(name)

  let size = blob.size
  if (!size) {
    try {
      const stat = await fs.fileStat(path)
      if (stat?.size) size = Number(stat.size)
    } catch (e) {
      console.warn('Failed to read file size for', path, e)
    }
  }

  return createImageAttachment({
    name,
    base64,
    dataUrl,
    mimeType,
    size,
  })
}
