import { browser, expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings, reloadRenderer } from '../helpers/settings'

/**
 * Settings → Interface theme + font-size persistence. Both stores use
 * Zustand `persist` against localStorage, which on Linux lives inside
 * the WebKit data dir under our pinned XDG profile — so reloading the
 * renderer should re-hydrate the user-selected values.
 *
 * We read the active value off `data-theme-active` / `data-font-size-active`
 * on the dropdown trigger (added in ThemeSwitcher / FontSizeSwitcher)
 * rather than visible text so the assertions stay independent of i18n.
 */

describe('Settings: Interface persistence', () => {
  before(async () => {
    await waitForApp()
  })

  it('persists theme and font-size selection across renderer reload', async () => {
    await openSettings('interface')

    // Theme: pick a value distinct from the default ("auto").
    const themeTrigger = await byTestId('theme-switcher-trigger')
    await themeTrigger.click()
    const themeLight = await byTestId('theme-option-light', 5_000)
    await themeLight.click()

    await browser.waitUntil(
      async () =>
        (await (await byTestId('theme-switcher-trigger')).getAttribute(
          'data-theme-active'
        )) === 'light',
      { timeout: 5_000, timeoutMsg: 'theme did not switch to light' }
    )

    // Font size: pick a value distinct from the default ("16px").
    const fontTrigger = await byTestId('font-size-switcher-trigger')
    await fontTrigger.click()
    const fontLarge = await byTestId('font-size-option-18px', 5_000)
    await fontLarge.click()

    await browser.waitUntil(
      async () =>
        (await (await byTestId('font-size-switcher-trigger')).getAttribute(
          'data-font-size-active'
        )) === '18px',
      { timeout: 5_000, timeoutMsg: 'font size did not switch to 18px' }
    )

    // Reload the renderer, return to the panel, assert both persisted.
    await reloadRenderer()
    await openSettings('interface')

    const themeAfter = await (await byTestId(
      'theme-switcher-trigger'
    )).getAttribute('data-theme-active')
    const fontAfter = await (await byTestId(
      'font-size-switcher-trigger'
    )).getAttribute('data-font-size-active')

    expect(themeAfter).toBe('light')
    expect(fontAfter).toBe('18px')
  })
})
