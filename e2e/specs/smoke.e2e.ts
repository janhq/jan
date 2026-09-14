import { browser, expect, $ } from '@wdio/globals'

// Side-effect-free by design, so importing it here does not re-run the profile
// creation that wdio.conf.ts does at module scope.
import { isolationEnv } from '../isolation.js'

// The worker inherits this from the launcher; see wdio.conf.ts. Read from the
// environment rather than importing the config, so the spec does not trigger a
// second evaluation of a module with top-level side effects.
const testHome = process.env.JAN_E2E_HOME!

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
async function goto(path: string) {
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
    async () =>
      (await browser.execute(() => window.location.pathname)) === path,
    { timeout: 20_000, timeoutMsg: `never navigated to ${path}` }
  )
}

describe('Jan desktop app', () => {
  before(async () => {
    // The webview has loaded the document. React mounting into it is asserted
    // by the first test rather than here, so a mount failure names a test
    // instead of dying in a hook.
    await $('#root').waitForExist({ timeout: 60_000 })
  })

  it('boots into the first-run setup screen', async () => {
    // Every run gets a fresh HOME, so no providers are configured and `/`
    // renders SetupScreen (routes/index.tsx). This doubles as the proof React
    // mounted, and makes the first-run state explicit: the navigation below
    // depends on it, and without this an onboarding change would surface as a
    // confusing "element not found" further down.
    await $('[data-testid="setup-wizard"]').waitForDisplayed({ timeout: 60_000 })
  })

  it('shows a data folder resolved by Rust, inside the throwaway HOME', async () => {
    await goto('/settings/general')

    const path = await $('[data-testid="app-data-folder-path"]')
    await path.waitForDisplayed({ timeout: 30_000 })

    // Assert the title attribute, not the text: the element is visually clipped
    // by `line-clamp-1 break-all`, and the component sets `title` to the full
    // untruncated path for exactly this reason.
    //
    // A path containing the temp HOME proves the whole chain -- React called
    // get_app_configurations over IPC, Rust resolved it from the HOME the
    // harness injected, and the value came back and reached the DOM.
    await expect(path).toHaveAttribute(
      'title',
      expect.stringContaining(testHome)
    )
  })
})

// Not a UI test: a regression guard for a destructive bug. Before isolation.ts
// pinned XDG_CONFIG_HOME, a run deleted the developer's real
// ~/.config/Jan/settings.json through the fs::copy + fs::remove_file
// legacy-config migration in core/app/commands.rs -- and nothing about the run
// looked wrong while it happened. Dropping any one of these puts that back.
describe('isolation environment', () => {
  it('confines every XDG base directory to the throwaway profile', function () {
    if (process.platform !== 'linux') this.skip()
    const env = isolationEnv(testHome)
    for (const key of [
      'XDG_DATA_HOME',
      'XDG_CONFIG_HOME',
      'XDG_STATE_HOME',
      'XDG_CACHE_HOME',
    ]) {
      expect(env[key]).toEqual(expect.stringContaining(testHome))
    }
  })
})
