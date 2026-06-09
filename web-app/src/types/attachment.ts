/**
 * Unified attachment type for images, documents, and audio
 */
export type Attachment = {
  name: string
  type:
    | 'image'
    | 'document'
    | 'audio'
    | 'browser-selection'
    | 'terminal-output'
    | 'runtime-log'
    | 'process-list'
    | 'context-brief'

  /** For audio attachments: 'wav' or 'mp3' per llama.cpp mtmd support. */
  audioFormat?: 'wav' | 'mp3'
  /** Audio duration in seconds (decoded client-side for the chip preview). */
  durationSec?: number

  // Common fields
  size?: number
  chunkCount?: number
  processing?: boolean
  processed?: boolean
  error?: string

  // For images (before upload)
  base64?: string
  dataUrl?: string
  mimeType?: string
  contentHash?: string // Used for deduplication (different files can have same name)

  // For documents (local files)
  path?: string
  fileType?: string // e.g., 'pdf', 'docx'
  parseMode?: 'auto' | 'inline' | 'embeddings' | 'prompt'

  // After processing (images uploaded, documents ingested)
  id?: string
  injectionMode?: 'inline' | 'embeddings'
  inlineContent?: string

  // Browser context selected from the workspace browser panel.
  browserSelection?: BrowserSelectionAttachment

  // Terminal output captured from an app-owned PTY session.
  terminalOutput?: TerminalOutputAttachment

  // Runtime logs captured from app-managed local runtimes.
  runtimeLog?: RuntimeLogAttachment

  // Running process snapshots captured from app-managed runtime registries.
  processList?: ProcessListAttachment

  // Structured inventory of context attached to the next message.
  contextBrief?: ContextBriefAttachment
}

export type BrowserSelectionAttachment = {
  targetId: string
  targetLabel: string
  url: string
  title?: string
  capturedAt: number
  selection?: {
    kind: 'page' | 'element' | 'region' | 'text'
    selectedText?: string
    selector?: string
    xpath?: string
    tagName?: string
    id?: string
    className?: string
    text?: string
    boundingBox?: {
      x: number
      y: number
      width: number
      height: number
    }
    computedStyles?: Record<string, string>
    screenshotDataUrl?: string
  }
}

export type TerminalOutputAttachment = {
  sessionId: string
  shell: string
  cwd?: string
  status: 'running' | 'exited' | 'failed'
  exitCode?: number | null
  capturedAt: number
  captureMode: 'selection' | 'scrollback'
  content: string
}

export type RuntimeLogAttachment = {
  source: 'app' | 'studio-runtime'
  sourceLabel: string
  runtimeId?: string
  logPath?: string
  capturedAt: number
  content: string
}

export type ProcessListAttachment = {
  source: 'studio-runtime' | 'codex-app-server' | 'system-process'
  sourceLabel: string
  capturedAt: number
  processes: Array<Record<string, unknown>>
}

export type ContextBriefAttachment = {
  capturedAt: number
  items: Array<{
    type: string
    name: string
    label: string
    details?: Record<string, unknown>
  }>
}

/**
 * Helper to create image attachment
 */
export function createImageAttachment(data: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  size: number
}): Attachment {
  return {
    ...data,
    type: 'image',
  }
}

/**
 * Helper to create audio attachment
 */
export function createAudioAttachment(data: {
  name: string
  base64: string
  dataUrl: string
  mimeType: string
  audioFormat: 'wav' | 'mp3'
  size: number
  durationSec?: number
}): Attachment {
  return {
    ...data,
    type: 'audio',
  }
}

/**
 * Helper to create document attachment
 */
export function createDocumentAttachment(data: {
  name: string
  path: string
  fileType?: string
  size?: number
  parseMode?: 'auto' | 'inline' | 'embeddings' | 'prompt'
}): Attachment {
  return {
    ...data,
    type: 'document',
  }
}

export function createBrowserSelectionAttachment(
  data: BrowserSelectionAttachment
): Attachment {
  const label =
    data.selection?.kind === 'element'
      ? 'Selected element'
      : data.selection?.kind === 'region'
        ? 'Selected region'
        : data.selection?.kind === 'text'
          ? 'Selected text'
          : 'Browser page'

  return {
    name: `${label}: ${data.title || data.url}`,
    type: 'browser-selection',
    processed: true,
    browserSelection: data,
  }
}

export function createTerminalOutputAttachment(
  data: TerminalOutputAttachment
): Attachment {
  const firstLine =
    data.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 60) || data.shell

  return {
    name: `Terminal ${data.captureMode}: ${firstLine}`,
    type: 'terminal-output',
    processed: true,
    terminalOutput: data,
  }
}

export function createRuntimeLogAttachment(
  data: RuntimeLogAttachment
): Attachment {
  return {
    name: `${data.sourceLabel} logs`,
    type: 'runtime-log',
    processed: true,
    runtimeLog: data,
  }
}

export function createProcessListAttachment(
  data: ProcessListAttachment
): Attachment {
  return {
    name: `${data.sourceLabel}: ${data.processes.length} process${data.processes.length === 1 ? '' : 'es'}`,
    type: 'process-list',
    processed: true,
    processList: data,
  }
}

export function createContextBriefAttachment(
  data: ContextBriefAttachment
): Attachment {
  return {
    name: `Context brief: ${data.items.length} item${data.items.length === 1 ? '' : 's'}`,
    type: 'context-brief',
    processed: true,
    contextBrief: data,
  }
}
