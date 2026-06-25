import type { CitationsPayload, RagCitation, WebCitation } from '@/components/Citations'

const tryParseJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

const isRagCitation = (x: unknown): x is RagCitation => {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.text === 'string' &&
    typeof o.file_id === 'string'
  )
}

const isWebCitation = (x: unknown): x is WebCitation => {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.url === 'string' && /^https?:\/\//.test(o.url)
}

const isTextItem = (it: unknown): it is { type: string; text: string } =>
  !!it &&
  typeof it === 'object' &&
  (it as { type?: string }).type === 'text' &&
  typeof (it as { text?: string }).text === 'string'

const extractTextItems = (output: unknown): string[] => {
  if (typeof output === 'string') return [output]
  if (Array.isArray(output)) {
    return output.filter(isTextItem).map((it) => it.text)
  }
  if (!output || typeof output !== 'object') return []
  const o = output as { content?: unknown }
  if (Array.isArray(o.content)) {
    return o.content.filter(isTextItem).map((it) => it.text)
  }
  return []
}

const fromRagPayload = (obj: Record<string, unknown>): CitationsPayload | null => {
  const citations = obj.citations
  if (!Array.isArray(citations)) return null
  const filtered = citations.filter(isRagCitation)
  if (!filtered.length) return null
  const scope = obj.scope === 'project' ? 'project' : 'thread'
  return {
    kind: 'rag',
    query: typeof obj.query === 'string' ? obj.query : undefined,
    scope,
    threadId: typeof obj.thread_id === 'string' ? obj.thread_id : undefined,
    projectId: typeof obj.project_id === 'string' ? obj.project_id : undefined,
    citations: filtered,
  }
}

const fromWebPayload = (obj: unknown): CitationsPayload | null => {
  let arr: unknown[] | null = null
  let query: string | undefined

  if (Array.isArray(obj)) {
    arr = obj
  } else if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    if (typeof o.query === 'string') query = o.query
    for (const key of ['results', 'citations', 'sources', 'data']) {
      const v = o[key]
      if (Array.isArray(v)) {
        arr = v
        break
      }
    }
  }

  if (!arr) return null
  const filtered = arr.filter(isWebCitation)
  if (!filtered.length) return null
  return { kind: 'web', query, citations: filtered }
}

export function parseCitationsFromToolOutput(
  output: unknown
): CitationsPayload | null {
  const texts = extractTextItems(output)
  for (const text of texts) {
    const parsed = tryParseJson(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rag = fromRagPayload(parsed as Record<string, unknown>)
      if (rag) return rag
    }
    if (parsed !== null) {
      const web = fromWebPayload(parsed)
      if (web) return web
    }
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const rag = fromRagPayload(output as Record<string, unknown>)
    if (rag) return rag
  }
  const web = fromWebPayload(output)
  if (web) return web

  return null
}
