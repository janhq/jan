import { expect, test as base } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { ElectronApplication, Page } from '@playwright/test'
import {
  findLatestBuild,
  parseElectronApp,
  stubDialog,
} from 'electron-playwright-helpers'

export const TIMEOUT: number = parseInt(process.env.TEST_TIMEOUT || '300000')

export let electronApp: ElectronApplication
export let page: Page

export async function setupElectron() {
  process.env.CI = 'e2e'

  const latestBuild = findLatestBuild('dist')
  expect(latestBuild).toBeTruthy()

  // parse the packaged Electron app and find paths and other info
  const appInfo = parseElectronApp(latestBuild)
  expect(appInfo).toBeTruthy()

  electronApp = await electron.launch({
    args: [appInfo.main], // main file from package.json
    executablePath: appInfo.executable, // path to the Electron executable
  })
  await stubDialog(electronApp, 'showMessageBox', { response: 1 })

  page = await electronApp.firstWindow({
    timeout: TIMEOUT,
  })
  // Return appInfo for future use
  return appInfo
}

export async function teardownElectron() {
  await page.close()
  await electronApp.close()
}

export const test = base.extend<{
  attachScreenshotsToReport: void
}>({
  attachScreenshotsToReport: [
    async ({ request }, use, testInfo) => {
      await use()

      // After the test, we can check whether the test passed or failed.
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page.screenshot()
        await testInfo.attach('screenshot', {
          body: screenshot,
          contentType: 'image/png',
        })
      }
    },
    { auto: true },
  ],
})


test.setTimeout(TIMEOUT)
