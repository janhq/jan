import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test.describe('Interact with local model', () => {
  test('Select USE local model from Hub and Chat', async ({ hubPage }) => {
    await hubPage.navigateByMenu()
    await hubPage.verifyContainerVisible()

    // Select the first GPT model
    await page
      .locator('[data-testid^="use-model-btn"][data-testid*="tinyllama"]')
      .first().click()

    await page
      .getByTestId('txt-input-chat')
      .fill('How many r\'s in strawberry?')

    // send chat
    await page
      .getByTestId('btn-send-chat')
      .click()

    await expect(page.locator('[data-testid^="toaster-"]')).toBeVisible({
      timeout: TIMEOUT,
    })

    await hubPage.waitLoadersCompleted()

    await expect(page.getByTestId('btn-stop-chat')).not.toBeVisible({
      timeout: TIMEOUT,
    })

    await expect(page.getByTestId('error-message')).not.toBeVisible({
      timeout: TIMEOUT,
    })

    await expect(page.getByTestId('btn-regenerate-msg')).toBeVisible({ timeout: TIMEOUT })

    const text = await page.getByTestId('lbl-token-speed').textContent()
    const tokenSpeed = parseFloat(text.match(/\d+(\.\d+)?/)[0])
    // Assertion to check if token speed is higher than 3 t/s
    expect(tokenSpeed).toBeGreaterThan(3)
  })

  test('Regenerate msg and verify API request ', async ({ hubPage }) => {
    let apiRequest
    await page.route('**/inferences/server/chat_completion', route => {
      apiRequest = route.request()
      route.continue()
    })

    await page.getByTestId('btn-regenerate-msg').click()

    await page.waitForResponse('**/inferences/server/chat_completion')

    await hubPage.waitLoadersCompleted()

    await expect(page.getByTestId('error-message')).not.toBeVisible({
      timeout: TIMEOUT,
    })

    // Verify request contains correct param
    const requestBody = JSON.parse(await apiRequest.postData())
    expect(requestBody).toMatchObject({
      'engine': 'cortex.llamacpp',
      'frequency_penalty': 0,
      'max_tokens': 2048,
      'presence_penalty': 0,
      'temperature': 0.6,
      'top_p': 0.95,
    })
  })
})

test('Select USE GPT model from Hub and Chat with Invalid API Key', async ({ hubPage }) => {
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
})