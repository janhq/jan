import { browser, $ } from '@wdio/globals'
import { byTestId, clickNav, DEFAULT_TIMEOUT } from './app'

/**
 * Settings tab IDs as exposed via `data-testid="settings-tab-<id>"` on the
 * settings sidebar entries. Keep in sync with `web-app/src/routes/settings/`.
 */
export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'model-providers'
  | 'shortcuts'
  | 'hardware'
  | 'mcp-servers'
  | 'local-api-server'
  | 'https-proxy'
  | 'extensions'
  | 'privacy'

/** Navigate to Settings and open a specific tab. */
export async function openSettings(tab: SettingsTab): Promise<void> {
  await clickNav('settings')
  await byTestId('settings-page', DEFAULT_TIMEOUT)
  const tabEl = await $(`[data-testid="settings-tab-${tab}"]`)
  await tabEl.waitForClickable({ timeout: DEFAULT_TIMEOUT })
  await tabEl.click()
  await byTestId(`settings-panel-${tab}`, DEFAULT_TIMEOUT)
}

/** Convenience: get any control by `settings-<tab>-<control>` testid. */
export async function settingsControl(tab: SettingsTab, control: string) {
  return byTestId(`settings-${tab}-${control}`)
}

/**
 * Reload the renderer (without restarting the Tauri shell or wiping the
 * profile dir). Useful for verifying that a setting persists across a
 * reload — full app-restart persistence requires JAN_KEEP_PROFILE.
 */
export async function reloadRenderer(): Promise<void> {
  await browser.refresh()
  await (await $('#root')).waitForExist({ timeout: 30_000 })
}
