import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('Select GPT model from Hub and Chat with Invalid API Key', async ({ hubPage }) => {
  await hubPage.navigateByMenu()
  await hubPage.verifyContainerVisible()

  // Select the first GPT model
  await page
    .locator('[data-testid^="use-model-btn"][data-testid*="gpt"]')
    .first().click()

  // Attempt to create thread and chat in Thread page
  await page
    .getByTestId('btn-create-thread')
    .click()

  await page
    .getByTestId('txt-input-chat')
    .fill('dummy value')

  await page
    .getByTestId('btn-send-chat')
    .click()

  await page.waitForFunction(() => {
    const loaders = document.querySelectorAll('[data-testid$="loader"]');
    return !loaders.length;
  }, { timeout: TIMEOUT });

  const APIKeyError = page.getByTestId('invalid-API-key-error')
  await expect(APIKeyError).toBeVisible({
    timeout: TIMEOUT,
  })
})
