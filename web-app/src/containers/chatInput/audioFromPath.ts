import { convertFileSrc } from '@tauri-apps/api/core'
import { fs } from '@janhq/core'

import { Attachment, createAudioAttachment } from '@/types/attachment'

/**
 * Map a filename extension to an audio MIME type. Restricted to mp3/wav — the
 * formats the omni backend accepts AND that the WebKit preview can play.
 */
export const audioMimeTypeFromExtension = (name: string): string => {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    default:
      return ''
  }
}

/**
 * Read the duration (seconds) of an audio source by loading its metadata.
 * Resolves 0 if the duration can't be determined (so callers never block on it).
 */
export const getAudioDurationSeconds = (src: string): Promise<number> =>
  new Promise((resolve) => {
    try {
      const audio = new Audio()
      audio.preload = 'metadata'
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoaded)
        audio.removeEventListener('error', onError)
      }
      const onLoaded = () => {
        const d = audio.duration
        cleanup()
        resolve(Number.isFinite(d) ? d : 0)
      }
      const onError = () => {
        cleanup()
        resolve(0)
      }
      audio.addEventListener('loadedmetadata', onLoaded)
      audio.addEventListener('error', onError)
      audio.src = src
    } catch {
      resolve(0)
    }
  })

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
 * Read an audio file by its filesystem path (Tauri only) and produce an
 * Attachment compatible with the chat attachment pipeline.
 *
 * Mirrors `readImageAttachmentFromPath`: uses Tauri's asset protocol via
 * `convertFileSrc`, then reads the blob as a data URL so the base64 payload can
 * be forwarded to the model as `input_audio`.
 */
export const readAudioAttachmentFromPath = async (
  path: string
): Promise<Attachment> => {
  const name = path.split(/[\\/]/).pop() || path

  const url = convertFileSrc(path)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to read audio (${response.status} ${response.statusText})`
    )
  }
  const blob = await response.blob()
  const dataUrl = await blobToDataUrl(blob)
  const base64 = dataUrl.split(',')[1] ?? ''

  const mimeType = audioMimeTypeFromExtension(name) || blob.type

  let size = blob.size
  if (!size) {
    try {
      const stat = await fs.fileStat(path)
      if (stat?.size) size = Number(stat.size)
    } catch (e) {
      console.warn('Failed to read file size for', path, e)
    }
  }

  return createAudioAttachment({
    name,
    base64,
    dataUrl,
    mimeType,
    size,
  })
}
