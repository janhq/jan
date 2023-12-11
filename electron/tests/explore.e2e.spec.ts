import { _electron as electron } from 'playwright'
import { ElectronApplication, Page, expect, test } from '@playwright/test'

import {
  findLatestBuild,
  parseElectronApp,
  stubDialog,
} from 'electron-playwright-helpers'

let electronApp: ElectronApplication
let page: Page

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

  page = await electronApp.firstWindow()
})

test.afterAll(async () => {
  await electronApp.close()
  await page.close()
})

test('explores models', async () => {
  await page.getByTestId('Hub').first().click()
  await page.getByTestId('testid-explore-models').isVisible()
  //   More test cases here...
})
