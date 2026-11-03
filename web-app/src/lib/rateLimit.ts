import { APICallError, RetryError } from 'ai'

/** Fallback wait: providers count tokens per minute, so a minute frees them. */
const DEFAULT_WAIT_MS = 60_000
const MIN_WAIT_MS = 1_000
const MAX_WAIT_MS = 120_000

const RATE_LIMIT_CODES = new Set(['rate_limit_exceeded'])
const RATE_LIMIT_TYPES = new Set(['too_many_requests', 'rate_limit_error'])

const clamp = (ms: number) => Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, ms))

/** The provider's error body, as `{ error: {...} }` or the error itself. */
function errorBodyOf(value: unknown): { code?: unknown; type?: unknown } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const inner = (value as { error?: unknown }).error
  if (inner && typeof inner === 'object') return inner as { code?: unknown; type?: unknown }
  return value as { code?: unknown; type?: unknown }
}

const isRateLimitBody = (value: unknown): boolean => {
  const body = errorBodyOf(value)
  return (
    (typeof body?.code === 'string' && RATE_LIMIT_CODES.has(body.code)) ||
    (typeof body?.type === 'string' && RATE_LIMIT_TYPES.has(body.type))
  )
}

const seconds = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const n = parseFloat(value)
  return Number.isNaN(n) ? undefined : n
}

/**
 * How long to wait before trying again, from a 429's headers. The token
 * counter's reset comes first: Azure's retry-after is often shorter than the
 * time its token counter needs, so a retry at retry-after fails again.
 */
function waitFromHeaders(headers: Record<string, string> | undefined): number {
  const resetTokens = seconds(headers?.['x-ratelimit-reset-tokens'])
  if (resetTokens !== undefined) return clamp(resetTokens * 1000)
  const retryAfterMs = seconds(headers?.['retry-after-ms'])
  if (retryAfterMs !== undefined) return clamp(retryAfterMs)
  const retryAfter = seconds(headers?.['retry-after'])
  if (retryAfter !== undefined) return clamp(retryAfter * 1000)
  return DEFAULT_WAIT_MS
}

/**
 * How long to wait before retrying a request the provider refused for its
 * rate limit, or null when `error` is not a rate-limit error. Covers an HTTP
 * 429 (also after the AI SDK's own retries gave up) and the error event the
 * Responses API sends when the limit is hit mid-stream, which has no headers.
 */
export function rateLimitRetryDelayMs(error: unknown): number | null {
  const last = RetryError.isInstance(error) ? error.lastError : error
  if (APICallError.isInstance(last)) {
    if (last.statusCode !== 429 && !isRateLimitBody(last.data)) return null
    return waitFromHeaders(last.responseHeaders)
  }
  return isRateLimitBody(last) ? DEFAULT_WAIT_MS : null
}
