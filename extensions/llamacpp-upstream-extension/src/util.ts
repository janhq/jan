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

/**
 * True iff `vb` is a CONCRETE `<version>/<backend>` string. Excludes empty,
 * `'none'`, no-slash, and the unresolved `latest/<backend>` sentinel. Strips
 * BOM / surrounding whitespace before checking (ATO-124).
 *
 * The bug this guards against: `version_backend.includes('/')` was used as a
 * proxy for "backend is resolved", but the sentinel `latest/<backend>` also
 * contains a `/` and passed that check, so the load path started before the
 * sentinel was resolved to a real release tag → `ensureBackendReady('latest')`
 * → `downloadAndInstallBackend` throws on the `version === 'latest'` guard →
 * web-app auto-restarts → tight retry-loop.
 */
export function isConcreteVersionBackend(
  vb: string | undefined | null
): boolean {
  const v = (vb ?? '').replace(/\uFEFF/g, '').trim()
  if (!v || v === 'none') return false
  if (!v.includes('/')) return false
  if (v.startsWith('latest/')) return false
  return true
}

/**
 * ATO-185: structured error code for "host CPU lacks the SIMD baseline the
 * shipped ggml-org CPU build requires". Surfaced to the web-app load-error
 * handler so it can render a clear, actionable message instead of the opaque
 * generic LLAMA_CPP_PROCESS_ERROR a silent SIGILL crash produces.
 */
export const CPU_NO_AVX_ERROR_CODE = 'CPU_NO_AVX'

/**
 * True iff `backend` is one of the CPU-only backend builds (no GPU offload).
 * Matches `win-cpu-x64`, `win-cpu-arm64`, `linux-cpu-x64`, `linux-cpu-arm64`.
 * The macOS backends (`macos-x64` / `macos-arm64`) deliberately do NOT match —
 * macOS is unaffected by the AVX issue (Apple Silicon has no AVX concept and
 * Intel Macs all ship AVX).
 */
export function isCpuBackend(backend: string | undefined | null): boolean {
  const b = (backend ?? '').replace(/\uFEFF/g, '').trim().toLowerCase()
  return b.includes('-cpu-')
}

/**
 * True iff the detected CPU extension list reports at least AVX. The shipped
 * ggml-org CPU build's lowest variant requires AVX (the "sandybridge" tier);
 * AVX2 / AVX-512 imply AVX. Mirrors the web-app `cpuAvxLevel` classification.
 */
export function cpuHasAvx(extensions: string[] | undefined | null): boolean {
  if (!extensions || extensions.length === 0) return false
  return extensions.some((e) => {
    const x = e.toLowerCase()
    return x === 'avx' || x === 'avx2' || x.startsWith('avx512')
  })
}

/**
 * ATO-185: decide whether to block a CPU-backend load because the host CPU is
 * too old to run the shipped binary. The shipped ggml-org CPU build executes
 * AVX instructions unconditionally, so an x86 CPU with no AVX at all dies with
 * SIGILL (Unix signal 4 / Windows STATUS_ILLEGAL_INSTRUCTION) the moment it
 * starts — leaving empty stderr that only surfaced as the opaque generic
 * LLAMA_CPP_PROCESS_ERROR (PostHog 30d: cpu_avx='none' fails 31.6% vs avx
 * 0.39%). We block only when we have a POSITIVE no-AVX signal: x86 arch, a
 * CPU backend, and a non-empty extension list that lacks AVX. An empty list
 * (non-x86 host or a hardware-probe failure) is never treated as "no AVX", so
 * we never false-block a capable machine.
 */
export function isUnsupportedNoAvxCpu(
  arch: string | undefined | null,
  backend: string | undefined | null,
  extensions: string[] | undefined | null
): boolean {
  const a = (arch ?? '').trim().toLowerCase()
  const isX86 = a === 'x86_64' || a === 'x86' || a === 'amd64'
  if (!isX86) return false
  if (!isCpuBackend(backend)) return false
  if (!extensions || extensions.length === 0) return false
  return !cpuHasAvx(extensions)
}

/**
 * True iff the load-error text is an MTP-rejection (MTP requested on a model
 * with no MTP layers / no draft head). llama.cpp surfaces no structured error
 * code for this, so we match the stderr text (ATO-125).
 */
export function matchesMtpLoadFailure(text: string): boolean {
  if (!text) return false
  return (
    /failed to create MTP context/i.test(text) ||
    /context type MTP requested/i.test(text) ||
    /doesn'?t contain MTP layers/i.test(text)
  )
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
