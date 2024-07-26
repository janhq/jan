import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('renders left navigation panel', async () => {
  const settingsBtn = await page
    .getByTestId('Thread')
    .first()
    .isEnabled({ timeout: TIMEOUT })
  expect([settingsBtn].filter((e) => !e).length).toBe(0)

  // System Monitor should be there
  await page.getByText('System Monitor').first().click({
    timeout: TIMEOUT,
  })
  const systemMonitors = page.getByText('Running Models').first()
  await expect(systemMonitors).toBeVisible({
    timeout: TIMEOUT,
  })
})
