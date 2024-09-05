import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('Select User local model from Hub and Chat', async ({ hubPage }) => {
  await hubPage.navigateByMenu()
  await hubPage.verifyContainerVisible()

  // Select the first GPT model
  await page
    .locator('[data-testid^="use-model-btn"][data-testid*="tinyllama"]')
    .first().click()

  await page
    .getByTestId('txt-input-chat')
    .fill('How many r\'s in strawberry?')

  await page
    .getByTestId('btn-send-chat')
    .click()

  await expect(page.locator('[data-testid^="toaster-"]')).toBeVisible()

  await hubPage.waitLoadersCompleted()

  await expect(page.getByTestId('error-message')).not.toBeVisible({
    timeout: TIMEOUT,
  })

  await expect(page.getByTestId('regenerate-msg')).toBeVisible({ timeout: TIMEOUT })

  const text = await page.getByTestId('token-speed').textContent()
  const tokenSpeed = parseFloat(text.match(/\d+(\.\d+)?/)[0])
  // Assertion to check if token speed is higher than 3 t/s
  expect(tokenSpeed).toBeGreaterThan(3)

  await page.getByTestId('regenerate-msg').click()

  await hubPage.waitLoadersCompleted()

  await expect(page.getByTestId('error-message')).not.toBeVisible({
    timeout: TIMEOUT,
  })
})

test('Select Use GPT model from Hub and Chat with Invalid API Key', async ({ hubPage }) => {
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

  await hubPage.waitLoadersCompleted()

  const APIKeyError = page.getByTestId('invalid-API-key-error')
  await expect(APIKeyError).toBeVisible({
    timeout: TIMEOUT,
  })
})

test('Thread dropdown option should be visible', async () => {

  await page.getByTestId('thread-menu').first().hover({ force: true })

  await expect(page.getByTestId('btn-edit-title').first()).toBeVisible()
  await expect(page.getByTestId('btn-clean-thread').first()).toBeVisible()
  await expect(page.getByTestId('btn-delete-thread').first()).toBeVisible()

  // await expect(page.getByTestId('"toaster-"')).toBeVisible({
  //   timeout: 1,
  // })
})