import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('show onboarding screen without any threads created or models downloaded', async () => {
  await page.getByTestId('Thread').first().click({
    timeout: TIMEOUT,
  })
  const denyButton = page.locator('[data-testid="btn-deny-product-analytics"]')

  if ((await denyButton.count()) > 0) {
    await denyButton.click({ force: true })
  }

  const onboardScreen = page.getByTestId('onboard-screen')
  await expect(onboardScreen).toBeVisible({
    timeout: TIMEOUT,
  })
})
