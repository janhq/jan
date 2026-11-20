import { describeTransportError } from '@/lib/model-factory'
import { localNetworkHint } from '@/lib/local-network'
import { isMac } from '@/lib/shortcuts/platform'

/**
 * A provider request that never got an HTTP response: DNS, connect, TLS or
 * timeout. The message is already written for the user (what failed, the URL,
 * and on macOS the Local Network hint), so it can be shown as it is. HTTP
 * status errors (401, 403, 404) are not this type and keep their own wording.
 */
export class ProviderUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnreachableError'
  }
}

/**
 * The unreachable error for a request to `url` that rejected with `error`, or
 * null when `error` is not a transport failure. Call it on what the fetch
 * itself rejected with, never on an error built from a response status: those
 * can contain words such as "failed to fetch" without being a connection
 * failure.
 */
export function toProviderUnreachable(
  error: unknown,
  url: string
): ProviderUnreachableError | null {
  const friendly = describeTransportError(error)
  if (!friendly) return null
  const hint = localNetworkHint(url, isMac)
  return new ProviderUnreachableError(
    `${friendly} (${url})${hint ? ` ${hint}` : ''}`
  )
}

/**
 * `fetchImpl`, with a transport failure rethrown as a `ProviderUnreachableError`
 * naming the URL. Responses, including HTTP error statuses, pass through.
 */
export function withUnreachableErrors(
  fetchImpl: typeof fetch
): typeof fetch {
  return async (input, init) => {
    try {
      return await fetchImpl(input, init)
    } catch (error) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      throw toProviderUnreachable(error, url) ?? error
    }
  }
}

/**
 * The text for a failed model-list refresh: the unreachable message when that
 * is what happened, otherwise the generic localized `fallback`.
 */
export function refreshFailureText(error: unknown, fallback: string): string {
  return error instanceof ProviderUnreachableError ? error.message : fallback
}
