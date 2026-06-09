/**
 * Shared PostHog telemetry helpers (ATO-108 / ATO-109 / ATO-111).
 *
 * All values produced here obey the epic's PII contract: only enums, ids,
 * numbers, `*_bucket` strings and booleans. No prompt/response text, no file
 * paths, no usernames, no HF/API tokens, no GPU serials/UUIDs.
 */

export type DownloadStatus = 'started' | 'completed' | 'failed' | 'cancelled'

export type DownloadKind = 'model' | 'gpu_backend' | 'companion_artifact'

export type DownloadFailureReason =
  | 'http_404'
  | 'http_401_auth'
  | 'http_other'
  | 'checksum_mismatch'
  | 'size_mismatch'
  | 'disk_io'
  | 'network'
  | 'cancelled'
  | 'path_guard'
  | 'unknown'

export type OomSubtype = 'cuda' | 'vulkan' | 'metal' | 'host_ram' | 'unknown'

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'none'

export type CpuAvxLevel = 'none' | 'avx' | 'avx2' | 'avx512'

export type LoadBackend =
  | 'llamacpp'
  | 'llamacpp-upstream'
  | 'mlx'
  | 'foundation-models'
  | 'unknown'

const STDERR_TAIL_BYTES = 2048

/** Extract a quantization token from a model id (e.g. `Q4_K_M`, `IQ4_XS`, `4bit`). */
export function quantFromModelId(modelId?: string | null): string | null {
  if (!modelId) return null
  const match = modelId.match(
    /\b(IQ\d+_[A-Z0-9]+|Q\d+_[A-Z0-9_]+|Q\d+|MXFP\d+|\d+bit|bf16|fp16|fp8|f16|f32)\b/i
  )
  return match ? match[1] : null
}

/** Coarse size bucket so we never ship an exact byte fingerprint. */
export function sizeBucket(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return 'unknown'
  const gb = bytes / 1024 ** 3
  if (gb < 0.5) return 'lt_500mb'
  if (gb < 2) return '500mb_2gb'
  if (gb < 5) return '2_5gb'
  if (gb < 10) return '5_10gb'
  if (gb < 20) return '10_20gb'
  if (gb < 50) return '20_50gb'
  return 'gt_50gb'
}

/** Parse an `HTTP status NNN` token out of a stringly-typed download error. */
export function parseHttpStatus(err?: string | null): number | null {
  if (!err) return null
  const match = err.match(/HTTP status (\d{3})/i)
  return match ? parseInt(match[1], 10) : null
}

/** Classify a stringly-typed download error into a stable enum. */
export function classifyDownloadFailure(err?: string | null): DownloadFailureReason {
  if (!err) return 'unknown'
  const e = err.toLowerCase()
  if (/\b(abort|aborted|cancel|cancelled|canceled|stopped|interrupt)\b/.test(e))
    return 'cancelled'

  const status = parseHttpStatus(err)
  if (status === 404) return 'http_404'
  if (status === 401 || status === 403) return 'http_401_auth'
  if (status != null) return 'http_other'

  if (e.includes('hash verification')) return 'checksum_mismatch'
  if (e.includes('size verification')) return 'size_mismatch'
  if (
    e.includes('no such file') ||
    e.includes('permission denied') ||
    e.includes('disk') ||
    e.includes('io error') ||
    e.includes('os error')
  )
    return 'disk_io'
  if (
    e.includes('path') &&
    (e.includes('guard') ||
      e.includes('invalid') ||
      e.includes('outside') ||
      e.includes('traversal'))
  )
    return 'path_guard'
  if (
    e.includes('network') ||
    e.includes('connection') ||
    e.includes('dns') ||
    e.includes('timed out') ||
    e.includes('timeout') ||
    e.includes('failed to download')
  )
    return 'network'
  return 'unknown'
}

/** Map a download task/model id + type to the `download_kind` enum. */
export function downloadKind(
  idOrTask?: string | null,
  downloadType?: string | null
): DownloadKind {
  const id = (idOrTask ?? '').toLowerCase()
  if (id.includes('cudart')) return 'companion_artifact'
  if (downloadType === 'Backend' || id.includes('llamacpp-backend'))
    return 'gpu_backend'
  return 'model'
}

/** Best-effort OOM device classification from a sanitized stderr tail. */
export function oomSubtype(details?: string | null): OomSubtype {
  if (!details) return 'unknown'
  const d = details.toLowerCase()
  if (d.includes('cuda')) return 'cuda'
  if (d.includes('vulkan') || d.includes('vk_error')) return 'vulkan'
  if (d.includes('metal') || d.includes('iogpu') || d.includes('mtl')) return 'metal'
  if (d.includes('host') || d.includes('system memory') || d.includes('requires more ram'))
    return 'host_ram'
  return 'unknown'
}

/** Parse the projector type out of a `unknown projector type: X` stderr line. */
export function mmprojProjectorType(details?: string | null): string | null {
  if (!details) return null
  const match = details.match(/unknown projector type:\s*([A-Za-z0-9_]+)/i)
  return match ? match[1] : null
}

/**
 * Sensitive query-parameter names whose *values* must be redacted while the
 * parameter name and the rest of the URL/path are preserved (ATO-113 rule 3).
 */
const SENSITIVE_QUERY_KEYS =
  'token|key|api_key|apikey|auth|secret|password|access_token|refresh_token|sig|signature'

/**
 * Scrub the PII classes the epic forbids: usernames in paths, credentials in
 * proxy URLs, HF/API tokens, Bearer tokens, and the values of sensitive
 * query parameters. Path structure, folder names, and parameter names are
 * otherwise preserved (needed for debugging).
 */
export function scrubPii(text: string): string {
  return text
    .replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1<redacted>')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1<redacted>')
    .replace(/:\/\/[^/@\s]+:[^/@\s]+@/g, '://<redacted>@')
    .replace(/\bhf_[A-Za-z0-9]+/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(
      new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS})=)[^&#\\s"']+`, 'gi'),
      '$1<redacted>'
    )
}

/** Last ~2KB of an error's details, PII-scrubbed, for `model_load.stderr_tail`. */
export function sanitizeStderrTail(details?: string | null): string | undefined {
  if (!details) return undefined
  const tail =
    details.length > STDERR_TAIL_BYTES
      ? details.slice(details.length - STDERR_TAIL_BYTES)
      : details
  return scrubPii(tail)
}

/** Host-only extraction (no path/query/token) for `resolved_asset_url_host`. */
export function urlHost(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

export function isHfUrl(url?: string | null): boolean {
  const host = urlHost(url)
  return (
    !!host &&
    (host === 'huggingface.co' ||
      host === 'hf.co' ||
      host.endsWith('.huggingface.co') ||
      host.endsWith('.hf.co'))
  )
}

export function mapGpuVendor(raw?: string | null, isMac?: boolean): GpuVendor {
  if (raw) {
    const v = raw.toLowerCase()
    if (v.includes('nvidia')) return 'nvidia'
    if (v.includes('amd') || v.includes('advanced micro')) return 'amd'
    if (v.includes('intel')) return 'intel'
    if (v.includes('apple')) return 'apple'
  }
  if (isMac) return 'apple'
  return 'none'
}

export function cpuAvxLevel(extensions?: string[] | null): CpuAvxLevel {
  if (!extensions || extensions.length === 0) return 'none'
  const set = new Set(extensions.map((e) => e.toLowerCase()))
  if ([...set].some((e) => e.startsWith('avx512'))) return 'avx512'
  if (set.has('avx2')) return 'avx2'
  if (set.has('avx')) return 'avx'
  return 'none'
}

export function loadBackendFromProvider(provider?: string | null): LoadBackend {
  if (
    provider === 'llamacpp' ||
    provider === 'llamacpp-upstream' ||
    provider === 'mlx' ||
    provider === 'foundation-models'
  )
    return provider
  return 'unknown'
}

const downloadStartTimes = new Map<string, number>()
const finalizedDownloads = new Set<string>()

/** Record the start time of a download so terminal events can report duration. */
export function markDownloadStart(id: string): void {
  downloadStartTimes.set(id, Date.now())
  finalizedDownloads.delete(id)
}

/** Return elapsed ms since the matching `markDownloadStart`, or null. */
export function takeDownloadDuration(id: string): number | null {
  const start = downloadStartTimes.get(id)
  if (start == null) return null
  downloadStartTimes.delete(id)
  return Date.now() - start
}

/**
 * Guard so a single download emits exactly one terminal `model_download` event,
 * even when both `onFileDownloadSuccess` and
 * `onFileDownloadAndVerificationSuccess` fire. Returns true only the first time.
 */
export function finalizeDownloadOnce(id: string): boolean {
  if (finalizedDownloads.has(id)) return false
  finalizedDownloads.add(id)
  if (finalizedDownloads.size > 500) finalizedDownloads.clear()
  return true
}
