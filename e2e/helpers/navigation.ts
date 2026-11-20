import { browser } from '@wdio/globals'

/**
 * Push a history entry the way the router expects, without waiting for a route
 * to settle.
 *
 * A hard `browser.url()` would ask the Tauri asset protocol for a deep path it
 * has no SPA fallback for, and 404. TanStack patches `history.pushState` to
 * notify its own subscribers (@tanstack/history), so pushing is enough on its
 * own -- no synthetic popstate needed.
 *
 * The state object matters: TanStack tracks position in `__TSR_index` and
 * computes back/forward deltas by subtracting it. Pushing a bare `{}` wipes
 * that key and turns later deltas into NaN, so carry the index forward.
 *
 * Split out of `goto()` for routes that answer with a redirect: there the
 * requested path never becomes the current one, so a caller has to wait for
 * where the app lands instead.
 */
export async function pushRoute(path: string) {
  await browser.execute((target: string) => {
    const previous = (window.history.state ?? {}) as Record<string, unknown>
    const index =
      typeof previous.__TSR_index === 'number' ? previous.__TSR_index + 1 : 0
    const key = Math.random().toString(36).slice(2, 10)
    window.history.pushState(
      { ...previous, __TSR_index: index, key, __TSR_key: key },
      '',
      target
    )
  }, path)
}

/** Wait until the app's current path is `path`. */
export async function waitForPath(path: string, timeout = 20_000) {
  await browser.waitUntil(
    async () => (await browser.execute(() => window.location.pathname)) === path,
    { timeout, timeoutMsg: `never navigated to ${path}` }
  )
}

/** Navigate the TanStack router client-side and wait for it to arrive. */
export async function goto(path: string) {
  await pushRoute(path)
  await waitForPath(path)
}
