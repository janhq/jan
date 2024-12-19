import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('Select GPT model from Hub and Chat with Invalid API Key', async ({
  hubPage,
}) => {
  await hubPage.navigateByMenu()
  await hubPage.verifyContainerVisible()

  // Select the first GPT model
  await page
    .locator('[data-testid^="use-model-btn"][data-testid*="gpt"]')
    .first()
    .click()

  await page.getByTestId('txt-input-chat').fill('dummy value')

  const denyButton = page.locator('[data-testid="btn-deny-product-analytics"]')

  if ((await denyButton.count()) > 0) {
    await denyButton.click({ force: true })
  } else {
    await page.getByTestId('btn-send-chat').click({ force: true })
  }

  await page.waitForFunction(
    () => {
      const loaders = document.querySelectorAll('[data-testid$="loader"]')
      return !loaders.length
    },
    { timeout: TIMEOUT }
  )
})
