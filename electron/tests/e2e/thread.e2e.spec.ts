import { expect } from '@playwright/test'
import { page, test, TIMEOUT } from '../config/fixtures'

test('create thread button', async () => {
  const settingsBtn = await page
    .getByTestId('btn-create-thread')
    .click()
  await page
    .getByTestId('txt-input-chat')
    .fill('dummy value')

  await page
    .getByTestId('btn-send-chat')
    .click()

  expect([settingsBtn].filter((e) => !e).length).toBe(0)
  // Chat section should be there
  await page.getByTestId('Local API Server').first().click({
    timeout: TIMEOUT,
  })
  const localServer = page.getByTestId('local-server-testid').first()
  await expect(localServer).toBeVisible({
    timeout: TIMEOUT,
  })
})
