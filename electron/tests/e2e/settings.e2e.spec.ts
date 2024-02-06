import { expect } from '@playwright/test'

import {
  setupElectron,
  teardownElectron,
  test,
  page,
  TIMEOUT,
} from '../pages/basePage'

test.beforeAll(async () => {
  await setupElectron()
})

test.afterAll(async () => {
  await teardownElectron()
})

test('shows settings', async () => {
  await page.getByTestId('Settings').first().click({ timeout: TIMEOUT })
  const settingDescription = page.getByTestId('testid-setting-description')
  await expect(settingDescription).toBeVisible({ timeout: TIMEOUT })
})
