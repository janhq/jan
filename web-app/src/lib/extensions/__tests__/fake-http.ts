import { vi } from 'vitest'
import type {
  HttpRequest,
  HttpResponse,
  HttpStreamEvent,
} from '@janhq/tauri-plugin-extensions-api'
import type { ExtensionHttp } from '../http'

/** What a fake server answers: a whole response, or a stream of chunks. */
export interface FakeReply {
  status?: number
  headers?: Record<string, string>
  body?: string
  /** Streamed in this order by `httpFetchStream`; `body` is ignored. */
  chunks?: string[]
  /** Never answers: the request hangs until cancelled. */
  hang?: boolean
}

export const redirectTo = (status: number, location: string): FakeReply => ({
  status,
  headers: { location },
})

interface Sent {
  extensionId: string
  requestId?: string
  req: HttpRequest
}

/**
 * A fake of the plugin's http commands with the same contract: no redirect
 * is followed, cookie headers never come back, a cancelled request rejects
 * with `{ kind: 'cancelled' }`. `answer` plays the server.
 */
export function fakeHttp(answer: (req: HttpRequest) => FakeReply | Promise<FakeReply>) {
  const sent: Sent[] = []
  const cancelled: string[] = []
  const waiting = new Map<string, () => void>()
  const cancelError = { kind: 'cancelled', message: 'The request was cancelled' }

  const reply = async (key: string, req: HttpRequest): Promise<FakeReply> => {
    const r = await answer(req)
    if (!r.hang) return r
    return new Promise<FakeReply>((_resolve, reject) =>
      waiting.set(key, () => reject(cancelError))
    )
  }
  const headersOf = (r: FakeReply) => {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(r.headers ?? {}))
      if (!/^set-cookie2?$/i.test(name)) headers[name.toLowerCase()] = value
    return headers
  }

  const http = {
    httpFetch: vi.fn<ExtensionHttp['httpFetch']>(
      async (extensionId, req, requestId) => {
        sent.push({ extensionId, requestId, req })
        const r = await reply(`${extensionId}\n${requestId}`, req)
        const response: HttpResponse = {
          status: r.status ?? 200,
          headers: headersOf(r),
          body: r.body ?? (r.chunks ?? []).join(''),
        }
        return response
      }
    ),
    httpFetchStream: vi.fn<ExtensionHttp['httpFetchStream']>(
      async (extensionId, requestId, req, onEvent) => {
        sent.push({ extensionId, requestId, req })
        const key = `${extensionId}\n${requestId}`
        const r = await reply(key, req)
        const status = r.status ?? 200
        const emit = (event: HttpStreamEvent) => onEvent(event)
        emit({ event: 'head', status, headers: headersOf(r) })
        for (const data of r.chunks ?? (r.body ? [r.body] : [])) {
          if (cancelled.includes(requestId)) {
            emit({ event: 'error', ...cancelError })
            return status
          }
          emit({ event: 'chunk', data })
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        emit({ event: 'end' })
        return status
      }
    ),
    httpCancel: vi.fn<ExtensionHttp['httpCancel']>(
      async (extensionId, requestId) => {
        cancelled.push(requestId)
        waiting.get(`${extensionId}\n${requestId}`)?.()
      }
    ),
  } satisfies ExtensionHttp

  return {
    http,
    sent,
    cancelled,
    /** The URLs requested, in order. */
    urls: () => sent.map((s) => s.req.url),
    /** The headers of every request, lowercase names. */
    headers: () =>
      sent.map(({ req }) => {
        const lower: Record<string, string> = {}
        for (const [name, value] of Object.entries(req.headers ?? {}))
          lower[name.toLowerCase()] = value
        return lower
      }),
  }
}
