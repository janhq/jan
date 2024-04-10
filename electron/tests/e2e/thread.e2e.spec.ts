import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('Select GPT model for chat via Use model button from Jan Hub', async ({ hubPage }) => {
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

  const APIKeyError = page.getByTestId('invalid-API-key-error')
  await expect(APIKeyError).toBeVisible({
    timeout: TIMEOUT,
  })
})
