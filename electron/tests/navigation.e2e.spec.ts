import { _electron as electron } from 'playwright'
import { ElectronApplication, Page, expect, test } from '@playwright/test'

import {
  findLatestBuild,
  parseElectronApp,
  stubDialog,
} from 'electron-playwright-helpers'

let electronApp: ElectronApplication
let page: Page
const TIMEOUT: number = parseInt(process.env.TEST_TIMEOUT || '300000')

test.beforeAll(async () => {
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
})

test.afterAll(async () => {
  await electronApp.close()
  await page.close()
})

test('renders left navigation panel', async () => {
  test.setTimeout(TIMEOUT)
  const systemMonitorBtn = await page
    .getByTestId('System Monitor')
    .first()
    .isEnabled({
      timeout: TIMEOUT,
    })
  const settingsBtn = await page
    .getByTestId('Thread')
    .first()
    .isEnabled({ timeout: TIMEOUT })
  expect([systemMonitorBtn, settingsBtn].filter((e) => !e).length).toBe(0)
  // Chat section should be there
  await page.getByTestId('Local API Server').first().click({
    timeout: TIMEOUT,
  })
  const localServer = await page.getByTestId('local-server-testid').first()
  await expect(localServer).toBeVisible({
    timeout: TIMEOUT,
  })
})
