import {
  page,
  test,
  setupElectron,
  teardownElectron,
  TIMEOUT,
} from '../pages/basePage'
import { expect } from '@playwright/test'

test.beforeAll(async () => {
  const appInfo = await setupElectron()
  expect(appInfo.asar).toBe(true)
  expect(appInfo.executable).toBeTruthy()
  expect(appInfo.main).toBeTruthy()
  expect(appInfo.name).toBe('jan')
  expect(appInfo.packageJson).toBeTruthy()
  expect(appInfo.packageJson.name).toBe('jan')
  expect(appInfo.platform).toBeTruthy()
  expect(appInfo.platform).toBe(process.platform)
  expect(appInfo.resourcesDir).toBeTruthy()
})

test.afterAll(async () => {
  await teardownElectron()
})

test('explores hub', async () => {
  await page.getByTestId('Hub').first().click({
    timeout: TIMEOUT,
  })
  await page.getByTestId('hub-container-test-id').isVisible({
    timeout: TIMEOUT,
  })
})
