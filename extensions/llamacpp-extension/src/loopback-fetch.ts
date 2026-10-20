import { fetch as httpFetch } from '@tauri-apps/plugin-http'

/**
 * Requests to Jan's own engine, sent so that no proxy can capture them.
 *
 * `@tauri-apps/plugin-http` sends from Rust's reqwest, which reads
 * `HTTP(S)_PROXY` and the OS proxy setting and does not exempt loopback unless
 * `NO_PROXY` names it. Naming any proxy turns reqwest's environment and system
 * lookup off, and the no-proxy list covers every loopback host, so the
 * placeholder address is never dialled: these requests always go direct.
 *
 * Same technique as `loopbackFetch` in `web-app/src/lib/model-factory.ts`; the
 * extension is a separate bundle and cannot import from the web app. Only for
 * the engine's loopback port, never for a remote provider.
 */
export const LOOPBACK_DIRECT_PROXY = {
  all: { url: 'http://127.0.0.1:9', noProxy: 'localhost,127.0.0.1,::1' },
}

export const loopbackFetch: typeof httpFetch = (input, init) =>
  httpFetch(input, { ...init, proxy: LOOPBACK_DIRECT_PROXY })
