import { page, test, TIMEOUT, appInfo } from '../pages/basePage'
import { expect } from '@playwright/test'

test.beforeAll(async () => {
  expect(appInfo).toMatchObject({
    asar: true,
    executable: expect.anything(),
    main: expect.anything(),
    name: 'jan',
    packageJson: expect.objectContaining({ name: 'jan' }),
    platform: process.platform,
    resourcesDir: expect.anything(),
  })
})

test('explores hub', async () => {
  await page.getByTestId('Hub').first().click({
    timeout: TIMEOUT,
  })
  await page.getByTestId('hub-container-test-id').isVisible({
    timeout: TIMEOUT,
  })
})
