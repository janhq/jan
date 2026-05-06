import { expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings } from '../helpers/settings'

/**
 * Settings → Interface (Appearance): the panel mounts and exposes the
 * theme/font/accent controls + a Reset button. Theme/font *interaction*
 * specs require testids inside ThemeSwitcher/FontSizeSwitcher and will
 * land in a follow-up — see the e2e backlog.
 */
describe('Settings: Interface', () => {
  before(async () => {
    await waitForApp()
  })

  it('renders the interface panel with a working Reset action', async () => {
    await openSettings('interface')
    const panel = await byTestId('settings-panel-interface')
    expect(await panel.isDisplayed()).toBe(true)

    const text = await panel.getText()
    expect(text).toMatch(/Theme/i)
    expect(text).toMatch(/Font Size/i)
    expect(text).toMatch(/Accent/i)

    const reset = await byTestId('settings-interface-reset')
    expect(await reset.isClickable()).toBe(true)
  })
})
