import { browser, expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings, reloadRenderer } from '../helpers/settings'

/**
 * Settings → HTTPS Proxy: confirms the URL field is wired to the
 * useProxyConfig store and that values survive a renderer reload. Does
 * not exercise actual proxy traffic — that needs a real proxy server.
 *
 * The HTTPS Proxy route isn't exposed in the sidebar; openSettings drives
 * the tanstack router by URL for this tab.
 */
describe('Settings: HTTPS Proxy', () => {
  before(async () => {
    await waitForApp()
  })

  it('persists the proxy URL across a renderer reload', async () => {
    await openSettings('https-proxy')

    const url = await byTestId('settings-https-proxy-url')
    await url.setValue('')
    const value = 'http://proxy.test.local:8080'
    await url.setValue(value)

    await browser.waitUntil(async () => (await url.getValue()) === value, {
      timeout: 5_000,
      timeoutMsg: 'proxy URL input did not retain typed value',
    })

    await reloadRenderer()
    await openSettings('https-proxy')
    const urlAfter = await byTestId('settings-https-proxy-url')
    expect(await urlAfter.getValue()).toBe(value)
  })
})
