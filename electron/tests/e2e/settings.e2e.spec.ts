import { expect } from '@playwright/test'

import { test, page, TIMEOUT } from '../pages/basePage'

test.beforeAll(async () => {
  console.log('before settings')
})

test.afterAll(async () => {
  console.log('after settings')
})

test('shows settings', async () => {
  await page.getByTestId('Settings123').first().click()
  expect(true).toEqual(false)
  const settingDescription = page.getByTestId('testid-setting-description')
  await expect(settingDescription).toBeVisible({ timeout: TIMEOUT })
})
