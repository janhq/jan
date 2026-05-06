import { browser, $ } from '@wdio/globals'
import { byTestId, clickNav, DEFAULT_TIMEOUT } from './app'

/**
 * Settings tab IDs as exposed via `data-testid="settings-tab-<id>"` on the
 * settings sidebar entries. Keep in sync with `web-app/src/routes/settings/`.
 */
export type SettingsTab =
  | 'general'
  | 'interface'
  | 'assistant'
  | 'shortcuts'
  | 'hardware'
  | 'privacy'
  | 'local-api-server'
  | 'mcp-servers'
  | 'claude-code'
  | 'model-providers'
  | 'https-proxy'
  | 'extensions'

/**
 * Tabs reachable only by direct URL (not surfaced in the settings sidebar).
 * For these we drive the router via history.pushState + popstate, which
 * works for tanstack-router without forcing a full reload.
 */
const URL_ONLY_TABS: Partial<Record<SettingsTab, string>> = {
  'https-proxy': '/settings/https-proxy',
  extensions: '/settings/extensions',
}

/** Navigate to Settings and open a specific tab. */
export async function openSettings(tab: SettingsTab): Promise<void> {
  const urlPath = URL_ONLY_TABS[tab]
  if (urlPath) {
    await browser.execute((p: string) => {
      window.history.pushState({}, '', p)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, urlPath)
  } else {
    await clickNav('settings')
    await byTestId('settings-page', DEFAULT_TIMEOUT)
    const tabEl = await $(`[data-testid="settings-tab-${tab}"]`)
    await tabEl.waitForClickable({ timeout: DEFAULT_TIMEOUT })
    await tabEl.click()
  }
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
