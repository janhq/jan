import { browser, $, expect } from '@wdio/globals'

describe('Jan app smoke', () => {
  it('boots and renders the main window', async () => {
    // Wait for the React root to mount. Adjust selector once we have stable test ids.
    const root = await $('#root')
    await root.waitForExist({ timeout: 30_000 })
    expect(await browser.getTitle()).toMatch(/Jan/i)
  })
})
