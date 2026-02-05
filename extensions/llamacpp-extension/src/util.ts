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

export function getProxyConfig(): Record<
  string,
  string | string[] | boolean
> | null {
  try {
    // Retrieve proxy configuration from localStorage
    const proxyConfigString = localStorage.getItem('setting-proxy-config')
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

    // Log proxy configuration for debugging
    console.log('Using proxy configuration:', {
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
    console.error('Failed to parse proxy configuration:', error)
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

export function estimateTokensFromText(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  return Math.max(1, Math.ceil(text.length / Math.max(charsPerToken, 1)))
}

export function buildEmbedBatches(
  inputs: string[],
  ubatchSize: number,
  charsPerToken = DEFAULT_CHARS_PER_TOKEN
): EmbedBatch[] {
  // Ensure ubatch_size is large enough for at least 1 token with safety margin
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

  for (const text of inputs) {
    const estTokens = estimateTokensFromText(text, charsPerToken)

    // If single text exceeds safe limit, still allow it as single batch
    // (ensure at least one text per batch)
    if (estTokens > safeLimit) {
      if (current.length) push()
      batches.push({ batch: [text], offset })
      offset += 1
      continue
    }

    if (currentTokens + estTokens > safeLimit && current.length) {
      push()
    }

    current.push(text)
    currentTokens += estTokens
  }

  push()

  // Validate that no batch is empty
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
