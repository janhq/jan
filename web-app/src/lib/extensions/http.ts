import { ExtensionError, type ExtensionErrorCode } from '@janhq/extension-api'
import type * as Plugin from '@janhq/tauri-plugin-extensions-api'

/**
 * The network path of installed extensions: the http commands of
 * tauri-plugin-extensions. Rust re-reads the grants from extensions.json,
 * keeps no cookie jar, refuses Jan's local API port and follows no
 * redirect; the host follows them here, checking every hop.
 */
export type ExtensionHttp = Pick<
  typeof Plugin,
  'httpFetch' | 'httpFetchStream' | 'httpCancel'
>

export const MAX_REDIRECTS = 5
// Never forwarded either way: the host's cookies are not the extension's.
const COOKIE_HEADERS = new Set(['cookie', 'cookie2', 'set-cookie', 'set-cookie2'])
// What may follow a redirect to another origin. Anything else (Authorization,
// x-api-key and other custom credentials) was meant for the first origin.
const CORS_SAFELISTED_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-language',
  'content-type',
])
const METHODS: readonly Plugin.HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
]
// Statuses a web Response may not carry a body with.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

const isHttpMethod = (value: string): value is Plugin.HttpMethod =>
  (METHODS as readonly string[]).includes(value)

export const isCookieHeader = (name: string) =>
  COOKIE_HEADERS.has(name.toLowerCase())

const isRedirect = (status: number) =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308

/** One request of a redirect chain. */
export interface Hop {
  url: string
  method: Plugin.HttpMethod
  body?: string
  headers: Headers
}

/** A first hop: the method checked, cookie headers dropped. */
export function firstHop(
  url: string,
  method: string,
  headers: HeadersInit | undefined,
  body: string | undefined
): Hop {
  const upper = method.toUpperCase()
  if (!isHttpMethod(upper))
    throw new ExtensionError('E_INVALID_ARGS', `Unsupported method '${method}'`)
  const kept = new Headers()
  new Headers(headers).forEach((value, name) => {
    if (!isCookieHeader(name)) kept.set(name, value)
  })
  return { url, method: upper, body, headers: kept }
}

/**
 * The request a redirect leads to, or undefined when `status` is not one.
 * Credentials stay with the first origin, and a 303 (or a 301/302 after a
 * POST) turns into a GET without a body, as browsers do.
 */
export function nextHop(
  hop: Hop,
  status: number,
  location: string | undefined,
  redirects: number
): Hop | undefined {
  if (!isRedirect(status) || !location) return undefined
  if (redirects >= MAX_REDIRECTS)
    throw new ExtensionError('E_INVALID_ARGS', 'Too many redirects')
  const next = new URL(location, hop.url)
  const headers = new Headers(hop.headers)
  if (next.origin !== new URL(hop.url).origin)
    for (const name of [...headers.keys()])
      if (!CORS_SAFELISTED_HEADERS.has(name)) headers.delete(name)
  const toGet =
    status === 303 ||
    ((status === 301 || status === 302) && hop.method === 'POST')
  return {
    url: next.toString(),
    method: toGet ? 'GET' : hop.method,
    body: toGet ? undefined : hop.body,
    headers,
  }
}

export function toPluginRequest(hop: Hop): Plugin.HttpRequest {
  const headers: Record<string, string> = {}
  hop.headers.forEach((value, name) => {
    headers[name] = value
  })
  return {
    url: hop.url,
    method: hop.method,
    headers,
    ...(hop.body !== undefined ? { body: hop.body } : {}),
  }
}

/** Response headers without cookies. */
export function withoutCookies(
  headers: Record<string, string>
): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers))
    if (!isCookieHeader(name)) kept[name] = value
  return kept
}

const PLUGIN_ERROR_CODES: Partial<
  Record<Plugin.ExtensionsErrorKind, ExtensionErrorCode>
> = {
  denied: 'E_PERMISSION',
  invalid: 'E_INVALID_ARGS',
  notFound: 'E_NOT_FOUND',
  tooLarge: 'E_TOO_LARGE',
  cancelled: 'E_CANCELLED',
}

const isPluginError = (value: unknown): value is Plugin.ExtensionsError =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { kind?: unknown }).kind === 'string' &&
  typeof (value as { message?: unknown }).message === 'string'

/** A rejection of the plugin (`{ kind, message }`) as an ExtensionError. */
export function toExtensionError(error: unknown): ExtensionError {
  if (error instanceof ExtensionError) return error
  if (isPluginError(error))
    return new ExtensionError(
      PLUGIN_ERROR_CODES[error.kind] ?? 'E_INTERNAL',
      error.message
    )
  return new ExtensionError(
    'E_INTERNAL',
    error instanceof Error ? error.message : String(error)
  )
}

/** A request id for `httpCancel`; the plugin takes 1-64 characters. */
export const newRequestId = () => crypto.randomUUID()

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The request was aborted', 'AbortError')

interface StreamHead {
  status: number
  headers: Record<string, string>
  body: ReadableStream<Uint8Array>
}

/**
 * Starts `hop` through `httpFetchStream` and resolves at its head with the
 * body as a byte stream. Aborting `signal` or cancelling the body cancels
 * the request in Rust.
 */
function openStream(
  http: ExtensionHttp,
  extensionId: string,
  hop: Hop,
  signal: AbortSignal | undefined
): Promise<StreamHead> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  const requestId = newRequestId()
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  // Once the body is closed, errored or cancelled, events are dropped.
  let open = true
  let running = true
  const cancelRequest = () => {
    if (!running) return
    running = false
    void http.httpCancel(extensionId, requestId).catch(() => undefined)
  }
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      open = false
      cancelRequest()
    },
  })
  const settle = (end: (c: ReadableStreamDefaultController<Uint8Array>) => void) => {
    if (!open || !controller) return
    open = false
    end(controller)
  }
  return new Promise<StreamHead>((resolve, reject) => {
    let head = false
    const onAbort = () => {
      cancelRequest()
      const reason = abortReason(signal as AbortSignal)
      if (head) settle((c) => c.error(reason))
      else reject(reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => {
      running = false
      signal?.removeEventListener('abort', onAbort)
    }
    http
      .httpFetchStream(extensionId, requestId, toPluginRequest(hop), (event) => {
        switch (event.event) {
          case 'head':
            head = true
            resolve({ status: event.status, headers: event.headers, body })
            break
          case 'chunk':
            if (open) controller?.enqueue(encoder.encode(event.data))
            break
          case 'end':
            done()
            settle((c) => c.close())
            break
          case 'error':
            done()
            settle((c) => c.error(toExtensionError(event)))
            break
        }
      })
      .then(
        () => {
          done()
          if (!head)
            reject(
              new ExtensionError('E_INTERNAL', 'The request ended without a response')
            )
        },
        (error: unknown) => {
          done()
          const failure = toExtensionError(error)
          if (head) settle((c) => c.error(failure))
          else reject(failure)
        }
      )
  })
}

export interface ProviderFetchDeps {
  extensionId: string
  http: ExtensionHttp
  /** Throws unless the extension's grants allow `url`. */
  checkUrl: (url: string) => void
  /** Aborts every request when the extension stops. */
  stopped?: AbortSignal
}

/**
 * A `fetch` for the AI SDK that sends a contributed provider's requests
 * through the extension's own network path: every URL and every redirect
 * hop is checked against its grants, and the body streams back (SSE) as
 * Rust reads it. Aborting the request, or the extension stopping, cancels
 * it in Rust.
 */
export function createProviderFetch(
  deps: ProviderFetchDeps
): typeof globalThis.fetch {
  return async (input, init = {}) => {
    if (input instanceof Request)
      throw new TypeError('Extension providers take a URL, not a Request')
    if (init.body != null && typeof init.body !== 'string')
      throw new TypeError('Extension provider requests need a text body')
    const signals = [init.signal, deps.stopped].filter(
      (s): s is AbortSignal => s != null
    )
    const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined
    let hop = firstHop(
      String(input),
      init.method ?? 'GET',
      init.headers,
      init.body ?? undefined
    )
    for (let redirects = 0; ; redirects++) {
      deps.checkUrl(hop.url)
      const head = await openStream(deps.http, deps.extensionId, hop, signal)
      const next = nextHop(hop, head.status, head.headers.location, redirects)
      if (!next) {
        const headers = withoutCookies(head.headers)
        return new Response(
          NULL_BODY_STATUSES.has(head.status) ? null : head.body,
          { status: head.status, headers }
        )
      }
      void head.body.cancel()
      hop = next
    }
  }
}
