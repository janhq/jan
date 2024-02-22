import { expect } from '@playwright/test'

import { test, page, TIMEOUT } from '../config/fixtures'

test('shows settings', async () => {
  await page.getByTestId('Settings').first().click({
    timeout: TIMEOUT,
  })
  const settingDescription = page.getByTestId('testid-setting-description')
  await expect(settingDescription).toBeVisible({ timeout: TIMEOUT })
})
