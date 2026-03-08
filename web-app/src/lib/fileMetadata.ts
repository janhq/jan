/**
 * Utility functions for embedding and extracting file metadata from user prompts
 */

export interface FileMetadata {
  id: string
  name: string
  type?: string
  size?: number
  chunkCount?: number
  injectionMode?: 'inline' | 'embeddings'
}

const FILE_METADATA_START = '[ATTACHED_FILES]'
const FILE_METADATA_END = '[/ATTACHED_FILES]'

/**
 * Inject file metadata into user prompt at the end
 * @param prompt - The user's message
 * @param files - Array of file metadata
 * @returns Prompt with embedded file metadata
 */
export function injectFilesIntoPrompt(
  prompt: string,
  files: FileMetadata[]
): string {
  if (!files || files.length === 0) return prompt

  const fileLines = files
    .map((file) => {
      const parts = [`file_id: ${file.id}`, `name: ${file.name}`]
      if (file.type) parts.push(`type: ${file.type}`)
      if (typeof file.size === 'number') parts.push(`size: ${file.size}`)
      if (typeof file.chunkCount === 'number') parts.push(`chunks: ${file.chunkCount}`)
      if (file.injectionMode) parts.push(`mode: ${file.injectionMode}`)
      return `- ${parts.join(', ')}`
    })
    .join('\n')

  const fileBlock = `\n\n${FILE_METADATA_START}\n${fileLines}\n${FILE_METADATA_END}`

  return prompt + fileBlock
}

/**
 * Extract file metadata from user prompt
 * @param prompt - The prompt potentially containing file metadata
 * @returns Object containing extracted files and clean prompt
 */
export function extractFilesFromPrompt(prompt: string): {
  files: FileMetadata[]
  cleanPrompt: string
} {
  if (!prompt.includes(FILE_METADATA_START)) {
    return { files: [], cleanPrompt: prompt }
  }

  const startIndex = prompt.indexOf(FILE_METADATA_START)
  const endIndex = prompt.indexOf(FILE_METADATA_END)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return { files: [], cleanPrompt: prompt }
  }

  // Extract the file metadata block
  const fileBlock = prompt.substring(
    startIndex + FILE_METADATA_START.length,
    endIndex
  )

  // Parse file metadata (flexible key:value parser)
  const files: FileMetadata[] = []
  const lines = fileBlock.trim().split('\n')
  for (const line of lines) {
    const trimmed = line.replace(/^\s*-\s*/, '').trim()
    const parts = trimmed.split(',')
    const map: Record<string, string> = {}
    for (const part of parts) {
      const [k, ...rest] = part.split(':')
      if (!k || rest.length === 0) continue
      map[k.trim()] = rest.join(':').trim()
    }
    const id = map['file_id']
    const name = map['name']
    if (!id || !name) continue
    const type = map['type']
    const size = map['size'] ? Number(map['size']) : undefined
    const chunkCount = map['chunks'] ? Number(map['chunks']) : undefined
    const fileObj: FileMetadata = { id, name };
    if (type) {
      fileObj.type = type;
    }
    if (typeof size === 'number' && !Number.isNaN(size)) {
      fileObj.size = size;
    }
    if (typeof chunkCount === 'number' && !Number.isNaN(chunkCount)) {
      fileObj.chunkCount = chunkCount;
    }
    const injectionMode = map['mode']
    if (injectionMode === 'inline' || injectionMode === 'embeddings') {
      fileObj.injectionMode = injectionMode
    }
    files.push(fileObj);
  }

  // Extract clean prompt (everything before [ATTACHED_FILES])
  const cleanPrompt = prompt
    .substring(0, startIndex)
    .trim()

  return { files, cleanPrompt }
}
