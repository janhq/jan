/**
 * ATO-113: Sentry frontend integration for Atomic Chat.
 *
 * - Initialised once, early in `main.tsx`, before the router so the React
 *   `ErrorBoundary` and the global `window.onerror` / `unhandledrejection`
 *   handlers (default integrations) catch everything.
 * - Sending is gated behind the existing `productAnalytic` consent: we do NOT
 *   re-init on toggle; `beforeSend` / `beforeBreadcrumb` consult the consent
 *   store and return `null` when it is off. This keeps "100% capture when
 *   consented" without re-init churn.
 * - Zero-PII: `sendDefaultPii: false`, anonymous device id only, and every
 *   outgoing event/breadcrumb is run through the shared `scrubPii` doctrine
 *   plus key-based redaction (tokens/creds/base_url) and request-body dropping.
 */
import * as Sentry from '@sentry/react'

import { useProductAnalytic } from '@/hooks/useAnalytic'
import { scrubPii } from '@/lib/telemetry'

let initialized = false

function consentEnabled(): boolean {
  try {
    return useProductAnalytic.getState().productAnalytic
  } catch {
    // Store not ready yet — fail closed (no send) until consent is known.
    return false
  }
}

/** Object keys whose values are dropped wholesale (creds / endpoints / PII). */
const SENSITIVE_KEY_RE =
  /^(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|access_token|refresh_token|auth|secret|password|passwd|base_url|hf_token|huggingface_token|proxy|email|username|user_name|ip|ip_address|serial|uuid|hostname|host_name|machine|machine_name)$/i

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubPii(value)
  if (Array.isArray(value)) return value.map(scrubValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '<redacted>' : scrubValue(val)
    }
    return out
  }
  return value
}

function scrubRecord(
  record: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!record) return record
  return scrubValue(record) as Record<string, unknown>
}

/** Run an event through the zero-PII doctrine in-place and return it. */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Never ship machine name; keep only the anonymous device id on user.
  event.server_name = undefined
  if (event.user) {
    event.user = { id: event.user.id }
  }

  if (typeof event.message === 'string') {
    event.message = scrubPii(event.message)
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubPii(exception.value)
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = scrubPii(frame.filename)
      if (frame.abs_path) frame.abs_path = scrubPii(frame.abs_path)
      // Local variables can capture prompt text / paths / tokens verbatim.
      frame.vars = undefined
    }
  }

  event.extra = scrubRecord(event.extra)

  if (event.request) {
    // The request body carries prompts; drop it. Keep a scrubbed URL shape.
    event.request.data = undefined
    event.request.cookies = undefined
    if (event.request.url) event.request.url = scrubPii(event.request.url)
    event.request.query_string = undefined
    event.request.headers = scrubRecord(
      event.request.headers as Record<string, unknown> | undefined
    ) as typeof event.request.headers
  }

  return event
}

function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  // Drop the noisiest free-text / network-body sources entirely.
  if (crumb.category === 'ui.input' || crumb.category === 'console') {
    return null
  }
  if (typeof crumb.message === 'string') {
    crumb.message = scrubPii(crumb.message)
  }
  if (crumb.data) {
    // fetch/xhr breadcrumbs may carry bodies; keep only structural fields.
    const data = scrubRecord(crumb.data) ?? {}
    delete data.body
    delete data.request_body
    delete data.response_body
    crumb.data = data
  }
  return crumb
}

export function initSentryFrontend(): void {
  if (initialized) return
  if (typeof SENTRY_DSN === 'undefined' || !SENTRY_DSN) return
  if (typeof IS_TAURI === 'undefined' || !IS_TAURI) return

  Sentry.init({
    dsn: SENTRY_DSN,
    release: typeof SENTRY_RELEASE !== 'undefined' ? SENTRY_RELEASE : undefined,
    environment:
      typeof SENTRY_ENVIRONMENT !== 'undefined' ? SENTRY_ENVIRONMENT : undefined,
    // Zero-PII + no perf/replay for now (ATO-113 scope).
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Keep DEFAULT integrations (so window.onerror / unhandledrejection are
    // auto-captured) but add no tracing/replay integration.
    beforeSend(event) {
      if (!consentEnabled()) return null
      return scrubEvent(event)
    },
    beforeBreadcrumb(crumb) {
      if (!consentEnabled()) return null
      return scrubBreadcrumb(crumb)
    },
  })

  initialized = true
}

/** Anonymous device id only ($is_identified:false equivalent). */
export function setSentryUser(deviceId: string | null | undefined): void {
  if (!initialized || !deviceId) return
  Sentry.setUser({ id: deviceId })
}

/** Set zero-PII hardware/backend context tags (string values only). */
export function setSentryTags(tags: Record<string, string>): void {
  if (!initialized) return
  Sentry.setTags(tags)
}

/**
 * Reflect a consent toggle into both SDKs. The frontend client is gated in
 * `beforeSend`; this also pushes the flag to the Rust telemetry gate.
 */
export function setSentryConsent(enabled: boolean): void {
  if (typeof IS_TAURI !== 'undefined' && IS_TAURI) {
    import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke('set_telemetry_consent', { enabled })
      )
      .catch(() => {
        // Rust telemetry may be unavailable (e.g. no DSN baked in) — ignore.
      })
  }
}

/** Push the same zero-PII tags to the Rust Sentry scope for crash parity. */
export function setRustSentryContext(tags: Record<string, string>): void {
  if (typeof IS_TAURI !== 'undefined' && IS_TAURI) {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_telemetry_context', { tags }))
      .catch(() => {
        // best-effort
      })
  }
}

type CaptureTags = Record<string, string | number | boolean | undefined | null>
type CaptureExtra = Record<string, unknown>

function dropEmpty(tags: CaptureTags): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

/**
 * Explicit capture for a user-facing error choke point. Tags are coerced to
 * strings and empties dropped; `extra` is passed through the same scrubber as
 * automatic events (via `beforeSend`).
 */
export function captureHandledError(
  error: unknown,
  level: Sentry.SeverityLevel,
  tags: CaptureTags,
  extra?: CaptureExtra
): void {
  if (!initialized) return
  Sentry.withScope((scope) => {
    scope.setLevel(level)
    scope.setTags(dropEmpty(tags))
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        scope.setExtra(key, value)
      }
    }
    if (error instanceof Error) {
      Sentry.captureException(error)
    } else {
      Sentry.captureMessage(
        typeof error === 'string' ? error : JSON.stringify(error),
        level
      )
    }
  })
}
