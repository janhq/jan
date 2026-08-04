import type { ToolUIPart } from 'ai'
import type { ToolOrigin } from './toolOrigin'

/** The call is still being written or executed: no result yet. */
export const isToolRunning = (state: ToolUIPart['state']) =>
  state === 'input-streaming' || state === 'input-available'

/**
 * The chrome a native tool call is presented as: web search reads as a search
 * bar the model types into, web fetch as an address bar.
 */
export type ToolCallBar =
  | { variant: 'search'; query: string; count?: number }
  | { variant: 'address'; url: string }
  | { variant: 'documents'; query: string; count?: number; fileCount?: number }

/**
 * Owned by the RAG extension (extensions/rag-extension/src/tools.ts) and not
 * exported through @janhq/core, so this must stay in sync with it. Only
 * `retrieve` gets a bar; the other RAG tools fall back to the generic card.
 */
export const RAG_RETRIEVE_TOOL = 'retrieve'

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * Build the bar for a native tool call from its arguments. Arguments stream in,
 * so a missing or partial value is normal and renders as an empty/partial bar
 * rather than being suppressed.
 */
export function describeNativeToolCall(
  origin: ToolOrigin | undefined,
  toolName: string,
  input: unknown
): ToolCallBar | undefined {
  if (!origin) return undefined
  const args = (input ?? {}) as Record<string, unknown>
  const asCount = (value: unknown) =>
    typeof value === 'number' ? value : undefined

  if (origin.kind === 'web-search') {
    return { variant: 'search', query: asString(args.query), count: asCount(args.count) }
  }
  if (origin.kind === 'web-fetch') {
    return { variant: 'address', url: asString(args.url) }
  }
  if (origin.kind === 'rag' && toolName === RAG_RETRIEVE_TOOL) {
    return {
      variant: 'documents',
      query: asString(args.query),
      count: asCount(args.top_k),
      fileCount: Array.isArray(args.file_ids) ? args.file_ids.length : undefined,
    }
  }
  return undefined
}

export type WebFetchPage = {
  title?: string
  url?: string
  content: string
  truncated: boolean
}

const TRUNCATION_MARKER = '\n\n[content truncated]'
const FETCH_HEADER = /^Title: (.*)\nURL: (.*)\n\n([\s\S]*)$/

/**
 * web_fetch returns a plain-text blob prefixed with `Title:` / `URL:` lines
 * (see executeWebTool), not a structured payload. Split it back apart so the
 * page can be presented as a page instead of a wall of text.
 */
export function parseWebFetchOutput(output: unknown): WebFetchPage | undefined {
  const text =
    typeof output === 'string'
      ? output
      : typeof (output as { content?: unknown })?.content === 'string'
        ? ((output as { content: string }).content)
        : undefined
  if (text === undefined) return undefined

  const truncated = text.endsWith(TRUNCATION_MARKER)
  const body = truncated ? text.slice(0, -TRUNCATION_MARKER.length) : text

  const match = body.match(FETCH_HEADER)
  if (!match) return { content: body, truncated }

  return {
    title: match[1] || undefined,
    url: match[2] || undefined,
    content: match[3],
    truncated,
  }
}
