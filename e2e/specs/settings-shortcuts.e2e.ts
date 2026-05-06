import { expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings } from '../helpers/settings'

/**
 * Settings → Shortcuts: panel renders and lists the documented shortcut
 * groups. We don't assert exact key bindings (those are platform-dependent
 * and live in `lib/shortcuts.ts`); we only assert the categories surface
 * and the panel is non-empty so visibility regressions are caught.
 */
describe('Settings: Shortcuts', () => {
  before(async () => {
    await waitForApp()
  })

  it('renders the shortcuts panel with all groups', async () => {
    await openSettings('shortcuts')
    const panel = await byTestId('settings-panel-shortcuts')
    expect(await panel.isDisplayed()).toBe(true)

    const text = await panel.getText()
    // Groups defined in routes/settings/shortcuts.tsx — i18n keys resolve
    // to these literals under the en locale that wdio.conf.ts pins.
    expect(text).toMatch(/Application/i)
    expect(text).toMatch(/Chat/i)
    expect(text).toMatch(/Navigation/i)

    // A handful of named shortcuts users expect to find.
    expect(text).toMatch(/New Chat/i)
    expect(text).toMatch(/Toggle Sidebar/i)
    expect(text).toMatch(/Send Message/i)
  })
})
