import { browser, $, expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings } from '../helpers/settings'

/**
 * Phase 5 surfaces that don't need a running model or external service:
 *
 *   - MCP Servers panel: empty state on a fresh profile, Add dialog opens
 *   - Local API Server panel: renders with Start button visible
 *   - Factory Reset: trigger surfaces in General → Advanced and opens
 *     the confirmation dialog (we do NOT confirm — destructive, would
 *     wipe the in-progress profile and break sibling tests)
 *
 * MCP-server CRUD with real env vars / streamable-http transport, the
 * /v1/models endpoint of the Local API Server, and Hub model-card
 * rendering all need external dependencies and live under specs/manual/.
 */

describe('Settings: MCP Servers', () => {
  before(async () => {
    await waitForApp()
  })

  it('renders the MCP servers panel on a fresh profile', async () => {
    await openSettings('mcp-servers')
    const panel = await byTestId('settings-panel-mcp-servers')
    expect(await panel.isDisplayed()).toBe(true)
  })

  it('opens the Add Server dialog from the header button', async () => {
    const add = await byTestId('mcp-add-server')
    await add.click()
    const dialog = await $('[role="dialog"]')
    await dialog.waitForDisplayed({ timeout: 10_000 })
    expect(await dialog.isDisplayed()).toBe(true)
    await browser.keys('Escape')
    await dialog.waitForExist({ reverse: true, timeout: 5_000 })
  })
})

describe('Settings: Local API Server', () => {
  before(async () => {
    await waitForApp()
  })

  it('renders the panel with the start/stop toggle visible', async () => {
    await openSettings('local-api-server')
    const panel = await byTestId('settings-panel-local-api-server')
    expect(await panel.isDisplayed()).toBe(true)

    const toggle = await byTestId('local-api-server-toggle')
    expect(await toggle.isDisplayed()).toBe(true)
    // Without a model loaded the button still exists; we only assert
    // shape, not that pressing it succeeds.
    expect((await toggle.getText()).trim().length).toBeGreaterThan(0)
  })
})

describe('Settings: Factory Reset', () => {
  before(async () => {
    await waitForApp()
  })

  it('opens the confirmation dialog without committing', async () => {
    await openSettings('general')

    const trigger = await byTestId('factory-reset-trigger', 15_000)
    await trigger.click()

    const dialog = await $('[role="dialog"]')
    await dialog.waitForDisplayed({ timeout: 10_000 })
    expect(await dialog.isDisplayed()).toBe(true)

    // Crucial: dismiss without confirming. A real reset wipes the
    // entire profile and would invalidate sibling tests in the run.
    await browser.keys('Escape')
    await dialog.waitForExist({ reverse: true, timeout: 5_000 })
  })
})
