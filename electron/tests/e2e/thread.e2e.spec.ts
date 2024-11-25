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

  await page.getByTestId('btn-send-chat').click()

  await page.waitForFunction(
    () => {
      const loaders = document.querySelectorAll('[data-testid$="loader"]')
      return !loaders.length
    },
    { timeout: TIMEOUT }
  )

  const APIKeyError = page.getByText(
    `You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY), or as the password field (with blank username) if you're accessing the API from your browser and are prompted for a username and password. You can obtain an API key from https://platform.openai.com/account/api-keys.`
  )
  await expect(APIKeyError).toBeVisible({
    timeout: TIMEOUT,
  })
})
