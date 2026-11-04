import { expect, $ } from '@wdio/globals'

import { goto, pushRoute, waitForPath } from '../helpers/navigation.js'

/**
 * Legacy Cowork execution ships in the `nightly` channel only (web-app/src/lib/version.ts), and
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
const AGENT_SETTINGS_ENTRY = 'a[href="/settings/cowork"]'
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

    // There is no Home/Cowork switcher any more; a link to /cowork would only
    // come from a Cowork entry, and none may exist on this channel.
    expect(await $(COWORK_TAB).isExisting()).toBe(false)
    // The Chat | Cowork selector is part of the home composer and hidden too.
    expect(await $('[data-testid="home-mode-toggle"]').isExisting()).toBe(false)
  })

  it('keeps Agent settings reachable on every channel', async () => {
    await goto('/settings/general')

    // Same bracket: the Data Folder row is General's own content, so the
    // settings page mounted before the menu is inspected.
    await $('[data-testid="app-data-folder-path"]').waitForDisplayed({
      timeout: 30_000,
    })

    expect(await $(AGENT_SETTINGS_ENTRY).isExisting()).toBe(true)
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

  it('sends a bookmarked per-conversation Cowork URL to Home', async () => {
    await pushRoute('/cowork/00000000-0000-4000-8000-000000000000')
    await waitForPath('/')

    expect(await $('[data-testid="cowork-surface"]').isExisting()).toBe(false)
  })

  it('keeps the unified artifacts library reachable', async () => {
    await pushRoute('/artifacts')
    await waitForPath('/artifacts')

    expect(await $('[data-testid="cowork-surface"]').isExisting()).toBe(false)
  })

  it('opens Agent settings at the compatibility settings URL', async () => {
    await pushRoute('/settings/cowork')
    await waitForPath('/settings/cowork')
    await $('h1=Agent').waitForDisplayed({ timeout: 30_000 })
    expect(await $(AGENT_SETTINGS_ENTRY).isExisting()).toBe(true)
  })
})
