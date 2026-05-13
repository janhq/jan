import { sanitizeModelId } from '@/lib/utils'

/**
 * Derives a local model id from a GGUF file path (folder import).
 */
export function buildModelIdFromPath(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || ''
  const baseName = fileName.replace(/\.(gguf|GGUF)$/, '')
  return sanitizeModelId(baseName.replace(/\s/g, '-'))
}
