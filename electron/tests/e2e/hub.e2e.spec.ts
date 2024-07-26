import { test, appInfo, page, TIMEOUT } from '../config/fixtures'
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

test('explores hub', async ({ hubPage }) => {
  await hubPage.navigateByMenu()
  await hubPage.verifyContainerVisible()

  const searchBar = page.getByTestId('hub-search-bar').first()
  await expect(searchBar).toBeVisible({
    timeout: TIMEOUT,
  })
})
