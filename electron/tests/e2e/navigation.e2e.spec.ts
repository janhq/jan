import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('renders left navigation panel', async () => {
  const threadBtn = page.getByTestId('Thread').first()
  await expect(threadBtn).toBeVisible({ timeout: TIMEOUT })
  // Chat section should be there
  await page.getByTestId('Local API Server').first().click({
    timeout: TIMEOUT,
  })
  const localServer = page.getByTestId('local-server-testid').first()
  await expect(localServer).toBeVisible({
    timeout: TIMEOUT,
  })
})
