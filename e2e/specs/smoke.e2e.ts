import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { browser, expect, $ } from '@wdio/globals'

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

// The regression guard for the destructive bug. Asserting on isolationEnv()
// directly would be tautological -- it returns join(home, ...), so checking the
// result contains `home` proves nothing, and would still pass if wdio.conf.ts
// stopped passing that env to the app at all.
//
// This asserts the opposite end: a file the Rust side wrote, at a path the Rust
// side resolved through dirs::data_dir(). It only exists here if the overridden
// environment actually reached the app process.
describe('on-disk isolation', () => {
  it('wrote its config inside the throwaway profile', async () => {
    // app_data_dir_with_fallback() -> data_dir()/Jan, + CONFIGURATION_FILE_NAME
    // (core/app/commands.rs, core/app/constants.rs).
    const settings =
      process.platform === 'darwin'
        ? join(testHome, 'Library/Application Support/Jan/settings.json')
        : join(testHome, '.local/share/Jan/settings.json')

    await browser.waitUntil(() => existsSync(settings), {
      timeout: 30_000,
      timeoutMsg:
        `the app never wrote ${settings}. Either it resolved data_dir() ` +
        'outside the throwaway profile -- which is the isolation failing -- or ' +
        'the config path changed in core/app/commands.rs.',
    })
  })
})
