import { expect, $ } from '@wdio/globals'

import { goto, pushRoute, waitForPath } from '../helpers/navigation.js'

/**
 * Legacy Cowork sessions are plain thread-backed sessions that open on every
 * channel; there is no channel gate any more. What the unified UI must still
 * never offer is a Cowork *entry point*: no sidebar tab and no mode switch.
 * Only existing sessions appear (in "Chats and tasks" and Artifacts), and they
 * are covered with seeded sessions by
 * web-app/src/components/left-sidebar/__tests__/NavHistory*.test.tsx and
 * web-app/src/routes/__tests__/artifacts.test.tsx. This suite cannot seed a
 * session into the launched app, so it proves what a fresh profile does with
 * the legacy URLs.
 */
const COWORK_TAB = 'a[href="/cowork"]'
const AGENT_SETTINGS_ENTRY = 'a[href="/settings/cowork"]'
const CHAT_SIDEBAR = '[data-testid="new-chat-button"]'

describe('Cowork has no entry point of its own', () => {
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
    // come from a Cowork entry, and none may exist.
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

  it('sends a bookmarked Cowork URL to Home when there is no session', async () => {
    // pushRoute and not goto: with no current session the route redirects, so `/cowork` never becomes
    // the current path and goto would wait for something that cannot happen.
    await pushRoute('/cowork')
    await waitForPath('/')

    // The URL alone would also settle back to `/` if the page had redirected
    // itself from a broken state, so assert the surface is not mounted.
    expect(await $('[data-testid="cowork-surface"]').isExisting()).toBe(false)
    await $(CHAT_SIDEBAR).waitForDisplayed({ timeout: 30_000 })
  })

  it('sends a Cowork URL for an unknown session to Home', async () => {
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
