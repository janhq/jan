import { browser } from '@wdio/globals'

/**
 * Navigate the TanStack router client-side.
 *
 * A hard `browser.url()` would ask the Tauri asset protocol for a deep path it
 * has no SPA fallback for, and 404. TanStack patches `history.pushState` to
 * notify its own subscribers (@tanstack/history), so pushing is enough on its
 * own -- no synthetic popstate needed.
 *
 * The state object matters: TanStack tracks position in `__TSR_index` and
 * computes back/forward deltas by subtracting it. Pushing a bare `{}` wipes
 * that key and turns later deltas into NaN, so carry the index forward.
 */
export async function goto(path: string) {
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

  await browser.waitUntil(
    async () => (await browser.execute(() => window.location.pathname)) === path,
    { timeout: 20_000, timeoutMsg: `never navigated to ${path}` }
  )
}
