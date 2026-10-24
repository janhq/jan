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

/**
 * How much of a streamed body may sit unread before the request is
 * cancelled. The AI SDK reads promptly; a body nobody reads would
 * otherwise buffer up to Rust's per-stream cap, per request.
 */
export const MAX_UNREAD_BYTES = 8 * 1024 * 1024

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The request was aborted', 'AbortError')

/**
 * Aborts when any of `signals` does. `AbortSignal.any` needs WebKitGTK
 * 2.44 / Safari 17.4, older than some webviews Jan runs in. `dispose`
 * detaches from the inputs, which may outlive the request (the extension's
 * stop signal does).
 */
export function combineSignals(signals: (AbortSignal | null | undefined)[]): {
  signal: AbortSignal | undefined
  dispose: () => void
} {
  const present = signals.filter((s): s is AbortSignal => s != null)
  if (present.length <= 1) return { signal: present[0], dispose: () => {} }
  const controller = new AbortController()
  const detach: (() => void)[] = []
  const dispose = () => detach.splice(0).forEach((d) => d())
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    const onAbort = () => {
      dispose()
      controller.abort(s.reason)
    }
    s.addEventListener('abort', onAbort, { once: true })
    detach.push(() => s.removeEventListener('abort', onAbort))
  }
  if (controller.signal.aborted) dispose()
  return { signal: controller.signal, dispose }
}

/**
 * Sends one hop through `httpFetch` (whole body, 1 MiB, 30 s). Aborting
 * `signal` cancels it in Rust; the rejection is then the abort reason.
 */
export async function fetchHop(
  http: ExtensionHttp,
  extensionId: string,
  hop: Hop,
  signal: AbortSignal | undefined
): Promise<Plugin.HttpResponse> {
  if (signal?.aborted) throw abortReason(signal)
  const requestId = newRequestId()
  const cancel = () =>
    void http.httpCancel(extensionId, requestId).catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await http.httpFetch(extensionId, toPluginRequest(hop), requestId)
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal)
    throw toExtensionError(error)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

interface StreamHead {
  status: number
  headers: Record<string, string>
  body: ReadableStream<Uint8Array>
  /** Settles once Rust is done with the request, however it ended. */
  finished: Promise<void>
}

/**
 * Starts `hop` through `httpFetchStream` and resolves at its head with the
 * body as a byte stream. Aborting `signal`, cancelling the body or leaving
 * more than MAX_UNREAD_BYTES unread cancels the request in Rust.
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
  let finish = () => {}
  const finished = new Promise<void>((resolve) => (finish = resolve))
  const cancelRequest = () => {
    if (!running) return
    running = false
    void http.httpCancel(extensionId, requestId).catch(() => undefined)
  }
  const body = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
      },
      cancel() {
        open = false
        cancelRequest()
      },
    },
    { highWaterMark: MAX_UNREAD_BYTES, size: (chunk) => chunk.byteLength }
  )
  const settle = (end: (c: ReadableStreamDefaultController<Uint8Array>) => void) => {
    if (!open || !controller) return
    open = false
    end(controller)
  }
  const enqueue = (data: string) => {
    if (!open || !controller) return
    controller.enqueue(encoder.encode(data))
    if ((controller.desiredSize ?? 0) >= 0) return
    cancelRequest()
    settle((c) =>
      c.error(
        new ExtensionError(
          'E_TOO_LARGE',
          `More than ${MAX_UNREAD_BYTES} bytes of the response were left unread`
        )
      )
    )
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
      finish()
    }
    http
      .httpFetchStream(extensionId, requestId, toPluginRequest(hop), (event) => {
        switch (event.event) {
          case 'head':
            head = true
            resolve({ status: event.status, headers: event.headers, body, finished })
            break
          case 'chunk':
            enqueue(event.data)
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

/**
 * `stream` (inference) streams the body back as Rust reads it; `whole`
 * (model listing, key tests) reads it at once through `httpFetch`, so its
 * 30 s timeout and 1 MiB cap apply.
 */
export type ProviderFetchMode = 'stream' | 'whole'

export interface ProviderFetchDeps {
  extensionId: string
  http: ExtensionHttp
  /** Throws unless the extension's grants allow `url`. */
  checkUrl: (url: string) => void
  /** Aborts every request when the extension stops. */
  stopped?: AbortSignal
  mode?: ProviderFetchMode
}

const responseBody = <T>(status: number, body: T): T | null =>
  NULL_BODY_STATUSES.has(status) ? null : body

/**
 * A `fetch` for the AI SDK that sends a contributed provider's requests
 * through the extension's own network path: every URL and every redirect
 * hop is checked against its grants, and in `stream` mode the body streams
 * back (SSE) as Rust reads it. Aborting the request, or the extension
 * stopping, cancels it in Rust.
 */
export function createProviderFetch(
  deps: ProviderFetchDeps
): typeof globalThis.fetch {
  const { extensionId, http, mode = 'stream' } = deps
  return async (input, init = {}) => {
    if (input instanceof Request)
      throw new TypeError('Extension providers take a URL, not a Request')
    if (init.body != null && typeof init.body !== 'string')
      throw new TypeError('Extension provider requests need a text body')
    const { signal, dispose } = combineSignals([init.signal, deps.stopped])
    try {
      let hop = firstHop(
        String(input),
        init.method ?? 'GET',
        init.headers,
        init.body ?? undefined
      )
      for (let redirects = 0; ; redirects++) {
        if (signal?.aborted) throw abortReason(signal)
        deps.checkUrl(hop.url)
        if (mode === 'whole') {
          const r = await fetchHop(http, extensionId, hop, signal)
          const next = nextHop(hop, r.status, r.headers.location, redirects)
          if (next) {
            hop = next
            continue
          }
          dispose()
          return new Response(responseBody(r.status, r.body), {
            status: r.status,
            headers: withoutCookies(r.headers),
          })
        }
        const head = await openStream(http, extensionId, hop, signal)
        const next = nextHop(hop, head.status, head.headers.location, redirects)
        if (next) {
          void head.body.cancel()
          hop = next
          continue
        }
        let response: Response
        try {
          response = new Response(responseBody(head.status, head.body), {
            status: head.status,
            headers: withoutCookies(head.headers),
          })
        } catch (error) {
          // A header value that is not Latin-1 (Rust decodes lossily) or a
          // status a Response cannot carry: nothing will read this body.
          void head.body.cancel()
          throw error
        }
        void head.finished.then(dispose)
        return response
      }
    } catch (error) {
      dispose()
      throw error
    }
  }
}
