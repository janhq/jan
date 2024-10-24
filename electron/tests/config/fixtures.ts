import {
  _electron as electron,
  BrowserContext,
  ElectronApplication,
  expect,
  Page,
  test as base,
} from '@playwright/test'
import {
  ElectronAppInfo,
  findLatestBuild,
  parseElectronApp,
  stubDialog,
} from 'electron-playwright-helpers'
import { Constants } from './constants'
import { HubPage } from '../pages/hubPage'
import { CommonActions } from '../pages/commonActions'
import { rmSync } from 'fs'
import * as path from 'path'

export let electronApp: ElectronApplication
export let page: Page
export let appInfo: ElectronAppInfo
export const TIMEOUT = parseInt(process.env.TEST_TIMEOUT || Constants.TIMEOUT)

export async function setupElectron() {
  console.log(`TEST TIMEOUT: ${TIMEOUT}`)

  process.env.CI = 'e2e'

  const latestBuild = findLatestBuild('dist')
  expect(latestBuild).toBeTruthy()

  // parse the packaged Electron app and find paths and other info
  appInfo = parseElectronApp(latestBuild)
  expect(appInfo).toBeTruthy()

  electronApp = await electron.launch({
    args: [appInfo.main], // main file from package.json
    executablePath: appInfo.executable, // path to the Electron executable
    // recordVideo: { dir: Constants.VIDEO_DIR }, // Specify the directory for video recordings
  })
  await stubDialog(electronApp, 'showMessageBox', { response: 1 })

  page = await electronApp.firstWindow({
    timeout: TIMEOUT,
  })
}

export async function teardownElectron() {
  await page.close()
  await electronApp.close()
}

/**
 * this fixture is needed to record and attach videos / screenshot on failed tests when
 * tests are run in serial mode (i.e. browser is not closed between tests)
 */
export const test = base.extend<
  {
    commonActions: CommonActions
    hubPage: HubPage
    attachVideoPage: Page
    attachScreenshotsToReport: void
  },
  { createVideoContext: BrowserContext }
>({
  commonActions: async ({ request }, use, testInfo) => {
    await use(new CommonActions(page, testInfo))
  },
  hubPage: async ({ commonActions }, use) => {
    await use(new HubPage(page, commonActions))
  },
  createVideoContext: [
    async ({ playwright }, use) => {
      const context = electronApp.context()
      await use(context)
    },
    { scope: 'worker' },
  ],

  attachVideoPage: [
    async ({ createVideoContext }, use, testInfo) => {
      await use(page)

      if (testInfo.status !== testInfo.expectedStatus) {
        const path = await createVideoContext.pages()[0].video()?.path()
        await createVideoContext.close()
        await testInfo.attach('video', {
          path: path,
        })
      }
    },
    { scope: 'test', auto: true },
  ],

  attachScreenshotsToReport: [
    async ({ commonActions }, use, testInfo) => {
      await use()

      // After the test, we can check whether the test passed or failed.
      if (testInfo.status !== testInfo.expectedStatus) {
        await commonActions.takeScreenshot('')
      }
    },
    { auto: true },
  ],
})

test.beforeAll(async () => {
  await rmSync(path.join(__dirname, '../../test-data'), {
    recursive: true,
    force: true,
  })

  test.setTimeout(TIMEOUT)
  await setupElectron()
  await page.waitForSelector('img[alt="Jan - Logo"]', {
    state: 'visible',
    timeout: TIMEOUT,
  })
})

test.afterAll(async () => {
  // temporally disabling this due to the config for parallel testing WIP
  // teardownElectron()
})
