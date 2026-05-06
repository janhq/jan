import { expect } from '@wdio/globals'
import { byTestId, waitForApp } from '../helpers/app'
import { openSettings } from '../helpers/settings'

/**
 * Settings → Hardware: the panel reads system info via the Tauri hardware
 * plugin. The exact values vary by host, but the OS / CPU / Memory cards
 * must always render with non-empty text.
 */
describe('Settings: Hardware', () => {
  before(async () => {
    await waitForApp()
  })

  it('renders OS, CPU, and Memory sections with values', async () => {
    await openSettings('hardware')
    await byTestId('settings-panel-hardware')

    const os = await byTestId('settings-hardware-os')
    const cpu = await byTestId('settings-hardware-cpu')
    const memory = await byTestId('settings-hardware-memory')

    expect((await os.getText()).trim().length).toBeGreaterThan(0)
    expect((await cpu.getText()).trim().length).toBeGreaterThan(0)
    expect((await memory.getText()).trim().length).toBeGreaterThan(0)

    // Memory reports a unit (GB / MB) once values arrive — guard against
    // a regression where the section renders only labels with no data.
    expect(await memory.getText()).toMatch(/[KMG]B/)
  })
})
