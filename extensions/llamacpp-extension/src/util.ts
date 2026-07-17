import { logger } from '@janhq/core'
import type {
  TemplateKwarg,
  TemplateKwargType,
} from '@janhq/tauri-plugin-llamacpp-api'
import { getBackendSetting, setBackendSetting } from './backend-settings'

// File path utilities
export function basenameNoExt(filePath: string): string {
  const VALID_EXTENSIONS = [".tar.gz", ".zip"];
  
  // handle VALID extensions first
  for (const ext of VALID_EXTENSIONS) {
    if (filePath.toLowerCase().endsWith(ext)) {
      return filePath.slice(0, -ext.length);
    }
  }
  
  // fallback: remove only the last extension
  const lastDotIndex = filePath.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return filePath.slice(0, lastDotIndex);
  }
  
  return filePath;
}

// Zustand proxy state structure
interface ProxyState {
  proxyEnabled: boolean
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  proxyIgnoreSSL: boolean
  verifyProxySSL: boolean
  verifyProxyHostSSL: boolean
  verifyPeerSSL: boolean
  verifyHostSSL: boolean
  noProxy: string
}

const DEFAULT_EMBEDDING_MODEL_KEY = 'default-embedding-model'

// The web-app's useDefaultEmbeddingModel store persists this key through
// the Rust settings backend (settings_get/settings_set -> settings.json),
// not webview localStorage, on desktop. Read/write the same backend so this
// extension sees the model the user actually picked in Settings; localStorage
// is only a fallback for `dev:web` (no Tauri shell).
async function readDefaultEmbeddingModelRaw(): Promise<string | null> {
  return getBackendSetting(DEFAULT_EMBEDDING_MODEL_KEY)
}

export async function getDefaultEmbeddingModelId(
  provider: string = 'llamacpp'
): Promise<string | undefined> {
  try {
    const raw = await readDefaultEmbeddingModelRaw()
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    const map = parsed?.state?.defaultByProvider
    const id = map && map[provider]
    return typeof id === 'string' && id.length > 0 ? id : undefined
  } catch {
    return undefined
  }
}

export async function setDefaultEmbeddingModelId(
  provider: string,
  modelId: string
) {
  try {
    const raw = await readDefaultEmbeddingModelRaw()
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 }
    const state = parsed.state ?? {}
    const map = state.defaultByProvider ?? {}
    map[provider] = modelId
    parsed.state = { ...state, defaultByProvider: map }
    if (parsed.version === undefined) parsed.version = 0
    const serialized = JSON.stringify(parsed)
    await setBackendSetting(DEFAULT_EMBEDDING_MODEL_KEY, serialized)
  } catch {
    /* non-fatal */
  }
}

export async function getProxyConfig(): Promise<Record<
  string,
  string | string[] | boolean
> | null> {
  try {
    const proxyConfigString = await getBackendSetting('setting-proxy-config')
    if (!proxyConfigString) {
      return null
    }

    const proxyConfigData = JSON.parse(proxyConfigString)

    const proxyState: ProxyState = proxyConfigData?.state

    // Only return proxy config if proxy is enabled
    if (!proxyState || !proxyState.proxyEnabled || !proxyState.proxyUrl) {
      return null
    }

    const proxyConfig: Record<string, string | string[] | boolean> = {
      url: proxyState.proxyUrl,
    }

    // Add username/password if both are provided
    if (proxyState.proxyUsername && proxyState.proxyPassword) {
      proxyConfig.username = proxyState.proxyUsername
      proxyConfig.password = proxyState.proxyPassword
    }

    // Parse no_proxy list if provided
    if (proxyState.noProxy) {
      const noProxyList = proxyState.noProxy
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)

      if (noProxyList.length > 0) {
        proxyConfig.no_proxy = noProxyList
      }
    }

    // Add SSL verification settings
    proxyConfig.ignore_ssl = proxyState.proxyIgnoreSSL
    proxyConfig.verify_proxy_ssl = proxyState.verifyProxySSL
    proxyConfig.verify_proxy_host_ssl = proxyState.verifyProxyHostSSL
    proxyConfig.verify_peer_ssl = proxyState.verifyPeerSSL
    proxyConfig.verify_host_ssl = proxyState.verifyHostSSL

    logger.info('Using proxy configuration:', {
      url: proxyState.proxyUrl,
      hasAuth: !!(proxyState.proxyUsername && proxyState.proxyPassword),
      noProxyCount: proxyConfig.no_proxy
        ? (proxyConfig.no_proxy as string[]).length
        : 0,
      ignoreSSL: proxyState.proxyIgnoreSSL,
      verifyProxySSL: proxyState.verifyProxySSL,
      verifyProxyHostSSL: proxyState.verifyProxyHostSSL,
      verifyPeerSSL: proxyState.verifyPeerSSL,
      verifyHostSSL: proxyState.verifyHostSSL,
    })

    return proxyConfig
  } catch (error) {
    logger.error('Failed to parse proxy configuration:', error)
    if (error instanceof SyntaxError) {
      // JSON parsing error - return null
      return null
    }
    // Other errors (like missing state) - throw
    throw error
  }
}

// --- Embedding batching helpers ---

export type EmbedBatch = { batch: string[]; offset: number }
export type EmbedUsage = { prompt_tokens?: number; total_tokens?: number }
export type EmbedData = { embedding: number[]; index: number }

export type EmbedBatchResult = {
  data: EmbedData[]
  usage?: EmbedUsage
}

// Embedding batching constants
const DEFAULT_CHARS_PER_TOKEN = 3
const UBATCH_SAFETY_MARGIN = 0.5

export const EMBEDDING_GGUF_ARCHS = new Set([
  'bert',
  'nomic-bert',
  'nomic-bert-moe',
  'jina-bert-v2',
  'jina-bert-v3',
  'xlm-roberta',
  'mpnet',
  't5encoder',
])

export function isEmbeddingArchitecture(arch: unknown): boolean {
  return typeof arch === 'string' && EMBEDDING_GGUF_ARCHS.has(arch)
}

export function detectEmbeddingFromGgufMeta(
  meta: Record<string, unknown> | undefined
): boolean {
  if (!meta) return false
  const arch = meta['general.architecture']
  if (typeof arch !== 'string') return false
  if (EMBEDDING_GGUF_ARCHS.has(arch)) return true
  if (arch.toLowerCase().includes('embed')) return true
  const raw = meta[`${arch}.pooling_type`]
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.length > 0
        ? Number(raw)
        : NaN
  return Number.isFinite(n) && n > 0
}

export function detectMtpLayersFromGgufMeta(
  meta: Record<string, unknown> | undefined
): number {
  if (!meta) return 0
  const tryParse = (raw: unknown): number => {
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.length > 0
          ? Number(raw)
          : NaN
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  const arch = meta['general.architecture']
  if (typeof arch === 'string' && arch.length > 0) {
    const n = tryParse(meta[`${arch}.nextn_predict_layers`])
    if (n > 0) return n
  }
  for (const [key, value] of Object.entries(meta)) {
    if (key.endsWith('.nextn_predict_layers')) {
      const n = tryParse(value)
      if (n > 0) return n
    }
  }
  return 0
}

const TEMPLATE_KWARG_RE =
  /\{%-?\s*set\s+([A-Za-z_]\w*)\s*=\s*\1\s*\|\s*default\(\s*([^)]*?)\s*\)/g

function parseJinjaDefault(raw: string): {
  type: TemplateKwargType
  value: boolean | number | string
} {
  const trimmed = raw.trim()
  if (trimmed === 'true' || trimmed === 'false') {
    return { type: 'boolean', value: trimmed === 'true' }
  }
  const quoted = trimmed.match(/^(['"])(.*)\1$/)
  if (quoted) {
    return { type: 'string', value: quoted[2] }
  }
  const n = Number(trimmed)
  if (trimmed.length > 0 && Number.isFinite(n)) {
    return { type: 'number', value: n }
  }
  return { type: 'string', value: trimmed }
}

/**
 * Extract chat-template kwargs a GGUF's embedded jinja template accepts. Matches
 * the self-defaulting idiom `{%- set X = X | default(<v>) -%}`, from which the
 * kwarg's control type is inferred. `enable_thinking` is owned by the reasoning
 * control and is intentionally excluded from the generic list.
 */
export function detectTemplateKwargsFromChatTemplate(
  template: unknown
): TemplateKwarg[] {
  if (typeof template !== 'string' || template.length === 0) return []
  const seen = new Set<string>()
  const out: TemplateKwarg[] = []
  const re = new RegExp(TEMPLATE_KWARG_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const name = m[1]
    if (name === 'enable_thinking' || seen.has(name)) continue
    seen.add(name)
    const { type, value } = parseJinjaDefault(m[2])
    out.push({ name, type, default: value })
  }
  return out
}

export function estimateTokensFromText(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  return Math.max(1, Math.ceil(text.length / Math.max(charsPerToken, 1)))
}

export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN
): string {
  const cpt = Math.max(charsPerToken, 1)
  const maxChars = Math.max(1, maxTokens) * cpt
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

export function buildEmbedBatches(
  inputs: string[],
  ubatchSize: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN
): EmbedBatch[] {
  const minUbatchSize = Math.ceil(1 / UBATCH_SAFETY_MARGIN)
  if (ubatchSize < minUbatchSize) {
    throw new Error(
      `ubatch_size (${ubatchSize}) is too small. Minimum required: ${minUbatchSize}`
    )
  }

  const safeLimit = Math.floor(ubatchSize * UBATCH_SAFETY_MARGIN)

  const batches: EmbedBatch[] = []
  let current: string[] = []
  let currentTokens = 0
  let offset = 0

  const push = () => {
    if (current.length) {
      batches.push({ batch: current, offset })
      offset += current.length
      current = []
      currentTokens = 0
    }
  }

  for (const raw of inputs) {
    const text =
      estimateTokensFromText(raw, charsPerToken) > safeLimit
        ? truncateToTokenBudget(raw, safeLimit, charsPerToken)
        : raw
    const estTokens = estimateTokensFromText(text, charsPerToken)

    if (currentTokens + estTokens > safeLimit && current.length) {
      push()
    }

    current.push(text)
    currentTokens += estTokens
  }

  push()

  if (batches.some(b => b.batch.length === 0)) {
    throw new Error('Internal error: empty batch detected')
  }

  return batches
}

export function mergeEmbedResponses(
  model: string,
  batchResults: Array<{ result: EmbedBatchResult; offset: number }>
) {
  const aggregated = {
    model,
    object: 'list',
    usage: { prompt_tokens: 0, total_tokens: 0 },
    data: [] as EmbedData[],
  }

  for (const { result, offset } of batchResults) {
    aggregated.usage.prompt_tokens += result.usage?.prompt_tokens ?? 0
    aggregated.usage.total_tokens += result.usage?.total_tokens ?? 0
    for (const item of result.data || []) {
      aggregated.data.push({ ...item, index: item.index + offset })
    }
  }

  return aggregated
}
