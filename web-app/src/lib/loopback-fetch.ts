import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import type { LoopbackFetch } from '@janhq/core'

/**
 * Requests to the local engine and MLX servers, sent so that no proxy can
 * capture them.
 *
 * `@tauri-apps/plugin-http` sends from Rust's reqwest, which reads
 * `HTTP(S)_PROXY` and the OS proxy setting (on Windows, the registry one) and
 * does not exempt loopback unless `NO_PROXY` names it. With a VPN client, a
 * proxy tool or a corporate proxy configured, the chat request to
 * `http://localhost:<port>` is then sent to that proxy and fails, although the
 * server is up. Naming any proxy turns reqwest's environment and system lookup
 * off, and the no-proxy list covers every loopback host, so the placeholder
 * address is never dialled: these requests always go direct.
 *
 * Only for loopback servers. Remote providers keep the runtime fetch, which
 * must go on honouring the user's proxy. Built-in engines get this as
 * `ctx.internal.loopbackFetch`.
 */
export const LOOPBACK_DIRECT_PROXY = {
  all: { url: 'http://127.0.0.1:9', noProxy: 'localhost,127.0.0.1,::1' },
}

export const loopbackFetch: LoopbackFetch = (input, init) =>
  httpFetch(input, { ...init, proxy: LOOPBACK_DIRECT_PROXY })
