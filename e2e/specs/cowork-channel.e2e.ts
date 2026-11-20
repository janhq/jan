import { expect, $ } from '@wdio/globals'

import { goto, pushRoute, waitForPath } from '../helpers/navigation.js'

/**
 * Cowork ships in the `nightly` channel only (web-app/src/lib/version.ts), and
 * this suite is the only place the *stable* half can be proven against a
 * launched app.
 *
 * `yarn build:e2e:app` builds the web app with vite and serves it from the
 * Tauri asset protocol, so the webview is not on localhost and VERSION carries
 * no `-`: exactly the channel where the surface must be absent. The render side
 * is covered by web-app/src/components/left-sidebar/__tests__/coworkGate.test.tsx
 * and web-app/src/lib/__tests__/coworkAccess.test.tsx, but neither can prove
 * what a bookmarked URL does in a real app, which is what this spec exists for.
 *
 * The nightly half is a manual step: the QA checklist carries it, because a
 * nightly build cannot be produced inside a single suite run.
 */
const COWORK_TAB = 'a[href="/cowork"]'
const COWORK_SETTINGS_ENTRY = 'a[href="/settings/cowork"]'
const CHAT_SIDEBAR = '[data-testid="new-chat-button"]'

describe('Cowork is hidden on a build that does not ship it', () => {
  before(async () => {
    await $('#root').waitForExist({ timeout: 60_000 })
    await goto('/')
  })

  it('shows the chat sidebar without a Cowork tab', async () => {
    // Positive control first: the chat surface's own control is on screen, so
    // the assertions below are about the sidebar that is actually rendered and
    // not about a shell that failed to mount. An absence check on its own
    // passes for the wrong reason (see "Writing specs" in e2e/README.md).
    await $(CHAT_SIDEBAR).waitForDisplayed({ timeout: 30_000 })

    // The tab and the Home/Cowork switcher are the same element: with Cowork
    // gone, the switcher has one surface left and NavTabs renders nothing at
    // all, so no Home pill survives without it.
    expect(await $(COWORK_TAB).isExisting()).toBe(false)
  })

  it('leaves the Cowork settings entry out of the settings menu', async () => {
    await goto('/settings/general')

    // Same bracket: the Data Folder row is General's own content, so the
    // settings page mounted before the menu is inspected.
    await $('[data-testid="app-data-folder-path"]').waitForDisplayed({
      timeout: 30_000,
    })

    expect(await $(COWORK_SETTINGS_ENTRY).isExisting()).toBe(false)
    // ...and the menu itself is there, since one of its other entries is.
    expect(await $('a[href="/settings/general"]').isExisting()).toBe(true)
  })

  it('sends a bookmarked Cowork URL to Home', async () => {
    // pushRoute and not goto: the guard redirects, so `/cowork` never becomes
    // the current path and goto would wait for something that cannot happen.
    await pushRoute('/cowork')
    await waitForPath('/')

    // The URL alone would also settle back to `/` if the page had redirected
    // itself from a broken state, so assert the surface is not mounted.
    expect(await $('[data-testid="cowork-surface"]').isExisting()).toBe(false)
    await $(CHAT_SIDEBAR).waitForDisplayed({ timeout: 30_000 })
  })

  it('sends a bookmarked artifacts URL to Home', async () => {
    await pushRoute('/artifacts')
    await waitForPath('/')

    expect(await $('[data-testid="cowork-surface"]').isExisting()).toBe(false)
  })

  it('sends the Cowork settings URL to General settings', async () => {
    await pushRoute('/settings/cowork')
    await waitForPath('/settings/general')

    await $('[data-testid="app-data-folder-path"]').waitForDisplayed({
      timeout: 30_000,
    })
    expect(await $(COWORK_SETTINGS_ENTRY).isExisting()).toBe(false)
  })
})
