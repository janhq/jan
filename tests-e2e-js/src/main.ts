import assert from 'node:assert'
import { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { By, until, WebDriver } from 'selenium-webdriver'
import * as e2e from '@tauri-e2e/selenium'
import { default as log4js } from 'log4js'

let logger = log4js.getLogger()
logger.level = 'debug'

process.env.TAURI_WEBDRIVER_LOGLEVEL = 'debug'
process.env.TAURI_WEBDRIVER_BINARY = await e2e.install.PlatformDriver()
process.env.TAURI_SELENIUM_BINARY = '../src-tauri/target/release/Jan.exe'
process.env.SELENIUM_REMOTE_URL = 'http://127.0.0.1:6655'

e2e.setLogger(logger)

describe('Tauri E2E tests', async () => {
  let driver: WebDriver
  let webDriver: ChildProcess

  beforeEach(async () => {
    // Spawn WebDriver process.
    webDriver = await e2e.launch.spawnWebDriver()
    // wait 1 second
    await new Promise((r) => setTimeout(r, 1000))
    // Create driver session.
    driver = new e2e.selenium.Builder().build()
    // Wait for the body element to be present
    // await driver.wait(until.elementLocated({ css: 'body' }))
  })

  afterEach(async () => {
    await e2e.selenium.cleanupSession(driver)
    e2e.launch.killWebDriver(webDriver)
  })

  test('Find hub', async () => {
    const hub = until.elementLocated(By.css('[data-test-id="menu-common:hub"'))
    // console.log('GG', hub)
    // @ts-ignore
    await driver.wait(hub.fn, 120000)

    const menuElement = await driver.findElement({
      css: '[data-test-id="menu-common:hub"]',
    })
    assert(menuElement !== null, 'Hub menu element should be available')
    await menuElement.isDisplayed()
  })
})
