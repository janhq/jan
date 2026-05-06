import { browser, $ } from '@wdio/globals'
import type { ChainablePromiseElement } from 'webdriverio'

export const DEFAULT_TIMEOUT = 15_000
export const BOOT_TIMEOUT = 30_000

/**
 * Wait for the React root to mount. Call once at the top of every spec's
 * `before` block. Idempotent across reuses of an existing session.
 */
export async function waitForApp(): Promise<void> {
  const root = await $('#root')
  await root.waitForExist({ timeout: BOOT_TIMEOUT })
}

/** Click a sidebar nav entry by its testid suffix (e.g. `hub`, `settings`). */
export async function clickNav(name: string): Promise<void> {
  const el = await $(`[data-testid="nav-${name}"]`)
  await el.waitForClickable({ timeout: DEFAULT_TIMEOUT })
  await el.click()
}

/** Resolve a single testid selector and wait for it to be displayed. */
export async function byTestId(
  id: string,
  timeout = DEFAULT_TIMEOUT
): Promise<ChainablePromiseElement> {
  const el = $(`[data-testid="${id}"]`)
  await el.waitForDisplayed({ timeout })
  return el
}

/** Returns true if the element exists in the DOM at the moment of the call. */
export async function existsTestId(id: string): Promise<boolean> {
  const el = await $(`[data-testid="${id}"]`)
  return el.isExisting()
}

/** Press Escape to dismiss any open dialog/popover and confirm it's gone. */
export async function dismissDialog(testId: string): Promise<void> {
  await browser.keys('Escape')
  const el = await $(`[data-testid="${testId}"]`)
  await el.waitForExist({ reverse: true, timeout: 5_000 })
}
