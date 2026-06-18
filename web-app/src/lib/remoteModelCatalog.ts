import { providerRemoteApiKeyChain } from './provider-api-keys'

export type RemoteCatalogModel = {
  id: string
  capabilities: string[]
  createdMs: number
  contextLength?: number
}

type ProviderLike = {
  provider: string
  base_url?: string
  api_key?: string
  api_key_fallbacks?: string[]
  custom_header?: { header: string; value: string }[] | null
}

type FetchImpl = typeof fetch

const TOP_N = 10

export function supportsRemoteCatalog(providerName: string): boolean {
  return (
    providerName === 'openai' ||
    providerName === 'anthropic' ||
    providerName === 'gemini' ||
    providerName === 'lemonade'
  )
}

function inferOpenAICapabilities(id: string): string[] | null {
  if (
    id.startsWith('text-embedding-') ||
    id.startsWith('whisper-') ||
    id.startsWith('tts-') ||
    id.startsWith('dall-e-') ||
    id.startsWith('gpt-image-') ||
    id.startsWith('omni-moderation-') ||
    id.startsWith('davinci-') ||
    id.startsWith('babbage-')
  ) {
    return null
  }
  if (
    id.startsWith('gpt-5') ||
    id.startsWith('gpt-4o') ||
    id.startsWith('gpt-4.1') ||
    id.startsWith('gpt-4.5') ||
    id.startsWith('gpt-4-turbo') ||
    id.startsWith('gpt-4-vision') ||
    id.startsWith('chatgpt-4o')
  ) {
    return ['completion', 'tools', 'vision']
  }
  if (id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) {
    return ['completion', 'tools', 'vision']
  }
  if (id.startsWith('gpt-4') || id.startsWith('gpt-3.5')) {
    return ['completion', 'tools']
  }
  return null
}

function stripModelsPrefix(id: string): string {
  return id.toLowerCase().replace(/^models\//, '')
}

function inferGeminiCapabilities(id: string): string[] | null {
  const lower = stripModelsPrefix(id)
  if (
    lower.startsWith('text-embedding-') ||
    lower.startsWith('embedding-') ||
    lower.startsWith('gemini-embedding') ||
    lower.startsWith('imagen-') ||
    lower.startsWith('veo-') ||
    lower.startsWith('aqa')
  ) {
    return null
  }
  if (!lower.startsWith('gemini-') && !lower.startsWith('gemma-')) return null
  return ['completion', 'tools', 'vision']
}

// Score Gemini/Gemma ids by version so the catalog sorts newest-first
// regardless of the `created` field (which is missing on Google's
// OpenAI-compat /models response).
export function geminiVersionScore(id: string): number {
  const lower = stripModelsPrefix(id)
  const match = lower.match(/^(?:gemini|gemma)-(\d+)(?:\.(\d+))?/)
  if (!match) return 0
  const major = Number(match[1])
  const minor = match[2] ? Number(match[2]) : 0
  return major * 100 + minor
}

function inferAnthropicCapabilities(id: string): string[] | null {
  if (!id.startsWith('claude-')) return null
  if (id.startsWith('claude-instant') || id.startsWith('claude-2')) {
    return ['completion', 'tools']
  }
  return ['completion', 'tools', 'vision']
}

const NON_CHAT_LABELS = new Set([
  'transcription',
  'tts',
  'image',
  'embeddings',
  'reranking',
  'upscaling',
])

export function inferLemonadeCapabilities(labels: string[]): string[] | null {
  if (labels.some((l) => NON_CHAT_LABELS.has(l))) return null
  const caps: string[] = ['completion']
  if (labels.includes('vision')) caps.push('vision')
  if (labels.includes('tool-calling')) caps.push('tools')
  if (labels.includes('chat-transcription')) caps.push('audio')
  return caps
}

function normalizeLemonadeCatalog(rows: unknown[]): RemoteCatalogModel[] {
  const parsed: RemoteCatalogModel[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    if (!id) continue
    const labels = Array.isArray(row.labels)
      ? (row.labels as unknown[]).filter((l): l is string => typeof l === 'string')
      : []
    const caps = inferLemonadeCapabilities(labels)
    if (!caps) continue
    const createdMs = parseCreated(row.created, row.created_at)
    const contextLength =
      typeof row.max_context_window === 'number' && row.max_context_window > 0
        ? row.max_context_window
        : undefined
    parsed.push({ id, capabilities: caps, createdMs, contextLength })
  }
  parsed.sort((a, b) => b.createdMs - a.createdMs || a.id.localeCompare(b.id))
  return parsed
}

function buildHeaders(p: ProviderLike, key: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) {
    headers['x-api-key'] = key
    headers['Authorization'] = `Bearer ${key}`
  }
  if (p.custom_header) {
    for (const h of p.custom_header) headers[h.header] = h.value
  }
  return headers
}

async function getJson(
  fetchImpl: FetchImpl,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; statusText: string; body: unknown }> {
  const response = await fetchImpl(url, { method: 'GET', headers })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
  }
}

export async function fetchTopRemoteModels(
  provider: ProviderLike,
  fetchImpl: FetchImpl
): Promise<RemoteCatalogModel[]> {
  if (!supportsRemoteCatalog(provider.provider)) {
    throw new Error(`Catalog not supported for ${provider.provider}`)
  }
  if (!provider.base_url) {
    throw new Error('Provider must have base_url configured')
  }

  const keyChain = providerRemoteApiKeyChain(provider)
  const attempts: (string | undefined)[] = keyChain.length > 0 ? keyChain : [undefined]

  let lastStatus = 0
  let lastStatusText = ''
  for (let i = 0; i < attempts.length; i++) {
    const result = await getJson(
      fetchImpl,
      `${provider.base_url}/models`,
      buildHeaders(provider, attempts[i])
    )
    lastStatus = result.status
    lastStatusText = result.statusText
    if (!result.ok) {
      if ([401, 403, 429].includes(result.status) && i < attempts.length - 1) continue
      throw new Error(`Failed to fetch models from ${provider.provider}: ${result.status} ${result.statusText}`)
    }

    const body = result.body as { data?: unknown }
    const rows = Array.isArray(body?.data) ? (body.data as unknown[]) : []
    return normalizeCatalog(provider.provider, rows)
  }

  throw new Error(`Failed to fetch models from ${provider.provider}: ${lastStatus} ${lastStatusText}`)
}

function normalizeCatalog(providerName: string, rows: unknown[]): RemoteCatalogModel[] {
  if (providerName === 'lemonade') {
    return normalizeLemonadeCatalog(rows)
  }
  const inferCaps =
    providerName === 'openai'
      ? inferOpenAICapabilities
      : providerName === 'gemini'
        ? inferGeminiCapabilities
        : inferAnthropicCapabilities

  const parsed: RemoteCatalogModel[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    if (!id) continue
    const caps = inferCaps(id)
    if (!caps) continue
    const createdMs = parseCreated(row.created, row.created_at)
    parsed.push({ id, capabilities: caps, createdMs })
  }

  if (providerName === 'gemini') {
    parsed.sort((a, b) => {
      const va = geminiVersionScore(a.id)
      const vb = geminiVersionScore(b.id)
      if (vb !== va) return vb - va
      return a.id.localeCompare(b.id)
    })
  } else {
    parsed.sort((a, b) => b.createdMs - a.createdMs || a.id.localeCompare(b.id))
  }
  return parsed.slice(0, TOP_N)
}

function parseCreated(created: unknown, createdAt: unknown): number {
  if (typeof created === 'number' && Number.isFinite(created)) {
    return created < 1e12 ? created * 1000 : created
  }
  if (typeof createdAt === 'string') {
    const t = Date.parse(createdAt)
    if (!Number.isNaN(t)) return t
  }
  return 0
}
