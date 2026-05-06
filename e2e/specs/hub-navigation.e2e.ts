import { browser, expect } from '@wdio/globals'
import { byTestId, clickNav, waitForApp } from '../helpers/app'

/**
 * Lightweight UI spec: exercises the sidebar -> Hub navigation and the
 * Hub search input without triggering any downloads. Intended as a fast
 * regression check that the Hub route mounts and the search field is wired.
 */
describe('Hub navigation', () => {
  before(async () => {
    await waitForApp()
  })

  it('navigates to the Hub from the sidebar', async () => {
    await clickNav('hub')
    const search = await byTestId('hub-search')
    expect(await search.isDisplayed()).toBe(true)
  })

  it('accepts input in the Hub search field', async () => {
    const search = await byTestId('hub-search')
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
