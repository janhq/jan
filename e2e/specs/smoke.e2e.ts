import { browser, expect } from '@wdio/globals'
import { waitForApp } from '../helpers/app'

describe('Jan app smoke', () => {
  it('boots and renders the main window', async () => {
    await waitForApp()
    expect(await browser.getTitle()).toMatch(/Jan/i)
  })
})
