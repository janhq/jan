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

export interface BrowserContextMetadata {
  targetId: string
  targetLabel: string
  url: string
  title?: string
  capturedAt: number
  selection?: unknown
}

export interface TerminalContextMetadata {
  sessionId: string
  shell: string
  cwd?: string
  status: string
  exitCode?: number | null
  capturedAt: number
  captureMode: 'selection' | 'scrollback'
  content: string
}

export interface RuntimeLogContextMetadata {
  source: 'app' | 'studio-runtime'
  sourceLabel: string
  runtimeId?: string
  logPath?: string
  capturedAt: number
  content: string
}

export interface ProcessListContextMetadata {
  source: 'studio-runtime' | 'codex-app-server' | 'system-process'
  sourceLabel: string
  capturedAt: number
  processes: Array<Record<string, unknown>>
}

export interface ContextBriefMetadata {
  capturedAt: number
  items: Array<{
    type: string
    name: string
    label: string
    details?: Record<string, unknown>
  }>
}

const FILE_METADATA_START = '[ATTACHED_FILES]'
const FILE_METADATA_END = '[/ATTACHED_FILES]'
const BROWSER_CONTEXT_START = '[BROWSER_CONTEXT]'
const BROWSER_CONTEXT_END = '[/BROWSER_CONTEXT]'
const TERMINAL_CONTEXT_START = '[TERMINAL_CONTEXT]'
const TERMINAL_CONTEXT_END = '[/TERMINAL_CONTEXT]'
const RUNTIME_LOG_CONTEXT_START = '[RUNTIME_LOG_CONTEXT]'
const RUNTIME_LOG_CONTEXT_END = '[/RUNTIME_LOG_CONTEXT]'
const PROCESS_LIST_CONTEXT_START = '[PROCESS_LIST_CONTEXT]'
const PROCESS_LIST_CONTEXT_END = '[/PROCESS_LIST_CONTEXT]'
const CONTEXT_BRIEF_START = '[CONTEXT_BRIEF]'
const CONTEXT_BRIEF_END = '[/CONTEXT_BRIEF]'

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

export function injectBrowserContextIntoPrompt(
  prompt: string,
  contexts: BrowserContextMetadata[]
): string {
  if (!contexts || contexts.length === 0) return prompt

  const contextBlock = contexts
    .map((context, index) =>
      JSON.stringify(
        {
          index,
          target_id: context.targetId,
          target_label: context.targetLabel,
          url: context.url,
          title: context.title,
          captured_at: context.capturedAt,
          selection: context.selection,
        },
        null,
        2
      )
    )
    .join('\n')

  return `${prompt}\n\n${BROWSER_CONTEXT_START}\n${contextBlock}\n${BROWSER_CONTEXT_END}`
}

export function injectTerminalContextIntoPrompt(
  prompt: string,
  contexts: TerminalContextMetadata[]
): string {
  if (!contexts || contexts.length === 0) return prompt

  const contextBlock = contexts
    .map((context, index) =>
      JSON.stringify(
        {
          index,
          session_id: context.sessionId,
          shell: context.shell,
          cwd: context.cwd,
          status: context.status,
          exit_code: context.exitCode,
          captured_at: context.capturedAt,
          capture_mode: context.captureMode,
          content: context.content,
        },
        null,
        2
      )
    )
    .join('\n')

  return `${prompt}\n\n${TERMINAL_CONTEXT_START}\n${contextBlock}\n${TERMINAL_CONTEXT_END}`
}

export function injectRuntimeLogContextIntoPrompt(
  prompt: string,
  contexts: RuntimeLogContextMetadata[]
): string {
  if (!contexts || contexts.length === 0) return prompt

  const contextBlock = contexts
    .map((context, index) =>
      JSON.stringify(
        {
          index,
          source: context.source,
          source_label: context.sourceLabel,
          runtime_id: context.runtimeId,
          log_path: context.logPath,
          captured_at: context.capturedAt,
          content: context.content,
        },
        null,
        2
      )
    )
    .join('\n')

  return `${prompt}\n\n${RUNTIME_LOG_CONTEXT_START}\n${contextBlock}\n${RUNTIME_LOG_CONTEXT_END}`
}

export function injectProcessListContextIntoPrompt(
  prompt: string,
  contexts: ProcessListContextMetadata[]
): string {
  if (!contexts || contexts.length === 0) return prompt

  const contextBlock = contexts
    .map((context, index) =>
      JSON.stringify(
        {
          index,
          source: context.source,
          source_label: context.sourceLabel,
          captured_at: context.capturedAt,
          processes: context.processes,
        },
        null,
        2
      )
    )
    .join('\n')

  return `${prompt}\n\n${PROCESS_LIST_CONTEXT_START}\n${contextBlock}\n${PROCESS_LIST_CONTEXT_END}`
}

export function injectContextBriefIntoPrompt(
  prompt: string,
  briefs: ContextBriefMetadata[]
): string {
  if (!briefs || briefs.length === 0) return prompt

  const contextBlock = briefs
    .map((brief, index) =>
      JSON.stringify(
        {
          index,
          captured_at: brief.capturedAt,
          items: brief.items,
        },
        null,
        2
      )
    )
    .join('\n')

  return `${prompt}\n\n${CONTEXT_BRIEF_START}\n${contextBlock}\n${CONTEXT_BRIEF_END}`
}

const stripRuntimeContextBlocks = (text: string): string =>
  stripMetadataBlock(
    stripMetadataBlock(
      stripMetadataBlock(
        stripMetadataBlock(
          stripMetadataBlock(
            text,
            BROWSER_CONTEXT_START,
            BROWSER_CONTEXT_END
          ),
          TERMINAL_CONTEXT_START,
          TERMINAL_CONTEXT_END
        ),
        RUNTIME_LOG_CONTEXT_START,
        RUNTIME_LOG_CONTEXT_END
      ),
      PROCESS_LIST_CONTEXT_START,
      PROCESS_LIST_CONTEXT_END
    ),
    CONTEXT_BRIEF_START,
    CONTEXT_BRIEF_END
  )

const stripMetadataBlock = (
  text: string,
  startMarker: string,
  endMarker: string
): string => {
  let next = text
  while (next.includes(startMarker)) {
    const startIndex = next.indexOf(startMarker)
    const endIndex = next.indexOf(endMarker, startIndex)
    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) break

    next =
      next.slice(0, startIndex) +
      next.slice(endIndex + endMarker.length)
  }

  return next.trim()
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
    return {
      files: [],
      cleanPrompt: stripRuntimeContextBlocks(prompt),
    }
  }

  const startIndex = prompt.indexOf(FILE_METADATA_START)
  const endIndex = prompt.indexOf(FILE_METADATA_END)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return {
      files: [],
      cleanPrompt: stripRuntimeContextBlocks(prompt),
    }
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

  const cleanPrompt = stripMetadataBlock(
    stripRuntimeContextBlocks(prompt),
    FILE_METADATA_START,
    FILE_METADATA_END
  )

  return { files, cleanPrompt }
}
