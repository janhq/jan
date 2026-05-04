import { browser, $, expect } from '@wdio/globals'

/**
 * Lightweight UI spec: exercises the sidebar -> Hub navigation and the
 * Hub search input without triggering any downloads. Intended as a fast
 * regression check that the Hub route mounts and the search field is wired.
 */
describe('Hub navigation', () => {
  before(async () => {
    await $('#root').waitForExist({ timeout: 30_000 })
  })

  it('navigates to the Hub from the sidebar', async () => {
    const navHub = await $('[data-testid="nav-hub"]')
    await navHub.waitForClickable({ timeout: 15_000 })
    await navHub.click()

    const search = await $('[data-testid="hub-search"]')
    await search.waitForDisplayed({ timeout: 15_000 })
    expect(await search.isDisplayed()).toBe(true)
  })

  it('accepts input in the Hub search field', async () => {
    const search = await $('[data-testid="hub-search"]')
    await search.waitForDisplayed({ timeout: 15_000 })

    // Clear any pre-existing value, then type a query that is unlikely to
    // match anything. We don't assert on the result list (it depends on
    // remote catalog state), only that the input retains the value.
    await search.setValue('')
    const query = 'zzz-no-such-model-xyz'
    await search.setValue(query)

    await browser.waitUntil(
      async () => (await search.getValue()) === query,
      { timeout: 5_000, timeoutMsg: 'hub-search did not retain typed value' }
    )
    expect(await search.getValue()).toBe(query)
  })
})
