import { browser, $, $$, expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings } from '../helpers/settings'

/**
 * Settings → Assistants: covers the surface that does not require a
 * running model — list rendering, the default-Jan invariant, opening the
 * Add dialog, and the default-fallback dropdown. Editing/deleting an
 * assistant flows through dialogs that close on Escape; we don't actually
 * mutate state to keep the spec hermetic across runs.
 */
describe('Settings: Assistants', () => {
  before(async () => {
    await waitForApp()
  })

  it('renders the assistants panel with at least the default Jan', async () => {
    await openSettings('assistant')
    const panel = await byTestId('settings-panel-assistant')
    expect(await panel.isDisplayed()).toBe(true)

    // There is always at least one default assistant (Jan).
    const items = await $$('[data-testid^="assistant-item-"]').getElements()
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(await panel.getText()).toMatch(/Jan/i)
  })

  it('opens the Add Assistant dialog from the header button', async () => {
    const addBtn = await byTestId('assistant-add-button')
    await addBtn.click()

    // AddEditAssistant is a Radix Dialog — confirm a dialog role appeared,
    // then close it without persisting.
    const dialog = await $('[role="dialog"]')
    await dialog.waitForDisplayed({ timeout: 10_000 })
    expect(await dialog.isDisplayed()).toBe(true)

    await browser.keys('Escape')
    await dialog.waitForExist({ reverse: true, timeout: 5_000 })
  })

  it('exposes the default-assistant dropdown with the assistant list', async () => {
    const trigger = await byTestId('assistants-default-trigger')
    await trigger.click()

    // Radix renders the menu in a portal; querying by role is the most
    // stable way without adding testids to every menu item.
    const menu = await $('[role="menu"]')
    await menu.waitForDisplayed({ timeout: 10_000 })
    const text = await menu.getText()
    expect(text).toMatch(/Jan/i)

    await browser.keys('Escape')
    await menu.waitForExist({ reverse: true, timeout: 5_000 })
  })

  it('opens the edit dialog for an existing assistant', async () => {
    const editButtons = await $$('[data-testid^="assistant-edit-"]').getElements()
    expect(editButtons.length).toBeGreaterThan(0)
    await editButtons[0].click()

    const dialog = await $('[role="dialog"]')
    await dialog.waitForDisplayed({ timeout: 10_000 })
    expect(await dialog.isDisplayed()).toBe(true)
    await browser.keys('Escape')
    await dialog.waitForExist({ reverse: true, timeout: 5_000 })
  })
})
