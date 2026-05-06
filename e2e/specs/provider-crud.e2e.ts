import { browser, $, expect } from '@wdio/globals'
import { byTestId, clickNav, waitForApp } from '../helpers/app'

/**
 * Custom Model Provider lifecycle. Drives the AddProviderDialog from
 * the Settings sidebar, navigates to the new provider's page, then
 * deletes it via the per-provider delete confirmation. Stays
 * UI-only — no real API key, no remote model traffic. Built-in
 * providers (OpenAI, Anthropic, …) are predefined and intentionally
 * cannot be deleted; we use a uniquely-named custom provider.
 */

const PROVIDER_NAME = `e2e-provider-${Date.now()}`

describe('Model Providers: custom-provider CRUD', () => {
  before(async () => {
    await waitForApp()
    await clickNav('settings')
    await byTestId('settings-page', 30_000)
  })

  it('creates a custom provider from the sidebar plus button', async () => {
    const addBtn = await byTestId('settings-add-provider')
    await addBtn.click()

    const input = await byTestId('add-provider-name', 10_000)
    await input.setValue(PROVIDER_NAME)

    const confirm = await byTestId('add-provider-confirm')
    await browser.waitUntil(async () => confirm.isEnabled(), {
      timeout: 5_000,
      timeoutMsg: 'add-provider-confirm never enabled',
    })
    await confirm.click()

    // Sidebar updates and the new provider's settings page loads.
    await byTestId(`provider-sidebar-${PROVIDER_NAME}`, 10_000)
    const page = await byTestId(`provider-page-${PROVIDER_NAME}`, 15_000)
    expect(await page.isDisplayed()).toBe(true)
  })

  it('deletes the custom provider from its settings page', async () => {
    const deleteTrigger = await byTestId('provider-delete-trigger', 10_000)
    await deleteTrigger.click()

    const confirm = await byTestId('provider-delete-confirm', 10_000)
    await confirm.click()

    // Sidebar entry disappears; the route redirects to another provider.
    const sidebar = await $(
      `[data-testid="provider-sidebar-${PROVIDER_NAME}"]`
    )
    await sidebar.waitForExist({ reverse: true, timeout: 10_000 })
    expect(await sidebar.isExisting()).toBe(false)
  })
})
