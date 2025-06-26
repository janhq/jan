import { ElementReference } from '@wdio/protocols'
import { IBasePage, BaseElements } from '@interface/iBasePage'
import { Browser } from 'webdriverio'
import { String as TString } from 'typescript-string-operations'
import { exec } from 'child_process'
import util from 'util'
const execAsync = util.promisify(exec)
const { execSync } = require('child_process')
export default abstract class BasePage implements IBasePage {
  elementsCom: BaseElements
  protected driver: Browser
  constructor(driver: Browser) {
    this.driver = driver
    this.elementsCom = {
      text: `//*[@value="{0}" or  @label="{0}" or @title="{0}"]`,
      textContains: `//*[contains(@value, "{0}") or contains(@label, "{0}") or contains(@title, "{0}")]`,
    }
  }

  async getElement(selector: string): Promise<ElementReference> {
    return await this.driver.$(selector)
  }

  async clickElement(selector: string): Promise<void> {
    const element = this.driver.$(selector)
    await element.click()
  }

  async clickElementByCoordinates(
    selector: string,
    addCenterX: number = 0,
    addCenterY: number = 0
  ): Promise<void> {
    await this.waitUntilElementIsVisible(selector)
    const element = this.driver.$(selector)
    const elementId = element['element-6066-11e4-a52e-4f735466cecf']
    // Use WebDriver's getElementRect command
    const rect = await this.driver.getElementRect(elementId)
    const centerX = Math.round(rect.x + rect.width / 2)
    const centerY = Math.round(rect.y + rect.height / 2)
    console.log(`👉 Clicking at coordinates: (${centerX}, ${centerY})`)
    await this.driver.performActions([
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 2,
            x: centerX + addCenterX,
            y: centerY + addCenterY,
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ])
    await this.driver.releaseActions()
  }

  async clickAtPoint(x: number, y: number): Promise<void> {
    await this.driver.performActions([
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 2,
            x: x,
            y: y,
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ])
    await this.driver.releaseActions()
  }

  async scrollToElement(selector: string): Promise<void> {
    const element = this.driver.$(selector)
    await element.scrollIntoView()
  }

  async sendKeys(selector: string, keys: string): Promise<void> {
    await this.clickElement(selector)
    const element = this.driver.$(selector)
    await element.setValue(keys)
  }

  async enterText(selector: string, text: string): Promise<void> {
    const element = await this.driver.$(selector)
    await element.setValue(text)
  }

  async terminateApp(appId?: string): Promise<void> {
    const app = appId || process.env.BUNDLE_ID
    if (!app) throw new Error('App ID (or process name) is required')

    await this.driver.terminateApp(app)
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await this.driver.pause(timeout)
  }

  public async activateApp(appId?: string): Promise<void> {
    const id = appId || process.env.BUNDLE_ID
    if (!id) throw new Error('Missing app ID')
    await this.driver.activateApp(id)
  }

  async elementShouldBeVisible(selector: string): Promise<boolean> {
    try {
      const element = this.driver.$(selector)
      return await element.isDisplayed()
    } catch (error) {
      return false
    }
  }

  async waitUntilElementIsVisible(
    selector: string,
    timeout = 5000
  ): Promise<void> {
    const element = this.driver.$(selector)
    await element.waitForDisplayed({ timeout })
  }

  async getActiveWindowName(): Promise<string> {
    try {
      const { stdout } = await execAsync(`xdotool getwindowfocus getwindowname`)
      return stdout.trim()
    } catch (err) {
      throw new Error(`❌ Failed to get active window name: ${err}`)
    }
  }

  async setWindowBounds(
    top: number = 50,
    left: number = 50,
    width: number = 1800,
    height: number = 900
  ): Promise<void> {
    try {
      const { stdout: winId } = await execAsync(`xdotool getactivewindow`)
      await execAsync(
        `wmctrl -i -r ${winId.trim()} -e 0,${left},${top},${width},${height}`
      )
    } catch (err) {
      throw new Error(`❌ Failed to set window bounds on Linux: ${err}`)
    }
  }

  async uploadFile(filePath: string): Promise<boolean> {
    try {
      const command = `
        sleep 1 && \
        xdotool key ctrl+l && \
        sleep 0.5 && \
        xdotool type --delay 50 "${filePath}" && \
        sleep 0.5 && \
        xdotool key Return && \
        sleep 0.5 && \
        xdotool key Return
      `
      await execAsync(command)
      return true
    } catch (err) {
      console.error('❌ File upload failed on Linux:', err)
      return false
    }
  }

  async getText(selector: string): Promise<string> {
    const element = await this.driver.$(selector)
    const attributes = ['title', 'label', 'value']
    for (const attr of attributes) {
      const text = await element.getAttribute(attr)
      if (text && text.trim() !== '') {
        return text
      }
    }
    return ''
  }

  async getAttribute(selector: string, attribute: string): Promise<string> {
    const element = await this.driver.$(selector)
    return await element.getAttribute(attribute)
  }

  async count(selector: string): Promise<number> {
    const elements = this.driver.findElements('xpath', selector)
    return (await elements).length
  }

  async isText(text: string): Promise<boolean> {
    const selector = TString.format(this.elementsCom.text, text)
    return await this.elementShouldBeVisible(selector)
  }

  async isTextContains(text: string): Promise<boolean> {
    const selector = TString.format(this.elementsCom.textContains, text)
    return await this.elementShouldBeVisible(selector)
  }

  async waitText(text: string, timeout?: number): Promise<void> {
    const selector = TString.format(this.elementsCom.text, text)
    await this.waitUntilElementIsVisible(selector, timeout)
  }

  async waitTextContains(text: string, timeout?: number): Promise<void> {
    const selector = TString.format(this.elementsCom.textContains, text)
    await this.waitUntilElementIsVisible(selector, timeout)
  }

  async isNotify(title: string, details: string): Promise<boolean> {
    try {
      const titleLocator = TString.format(this.elementsCom.text, title)
      await this.waitUntilElementIsVisible(titleLocator)
      if (details) {
        const detailsLocator = TString.format(this.elementsCom.text, details)
        await this.waitUntilElementIsVisible(detailsLocator)
      }
      return true
    } catch (error) {
      console.error('Notify is not displayed:', error)
      return false
    }
  }

  async pasteText(): Promise<void> {
    try {
      await execAsync(`xdotool key ctrl+v`)
    } catch (error) {
      console.error('❌ Failed to paste text on Linux:', error)
    }
  }

  async tapText(text: string): Promise<void> {
    const selector = TString.format(this.elementsCom.text, text)
    await this.clickElement(selector)
  }

  async getBrowserUrl(browser: string = 'Google'): Promise<string> {
    try {
      let script = ''
      if (browser == 'Safari') {
        script = `
          tell application "Safari"
            set currentURL to URL of front document
          end tell
          return currentURL
        `
      } else if (browser == 'Google') {
        script = `
          tell application "Google Chrome"
            set currentURL to URL of active tab of front window
          end tell
          return currentURL
        `
      }
      return execSync(`osascript -e '${script}'`).toString().trim()
    } catch (e) {
      console.error('Chrome not accessible or not open:', e)
      return ''
    }
  }

  async focusApp(appName: string): Promise<void> {
    const platform = process.platform
    if (platform === 'darwin') {
      try {
        const script = `
          tell application "${appName}"
            activate
          end tell
        `
        const { execSync } = await import('child_process')
        execSync(`osascript -e '${script}'`)
      } catch (e) {
        console.error(`❌ Could not bring ${appName} to front (macOS):`, e)
      }
    } else if (platform === 'linux') {
      try {
        const { stdout } = await execAsync(
          `wmctrl -l | grep -i "${appName}" | awk '{print $1}'`
        )
        const winId = stdout.trim().split('\n')[0]
        if (winId) {
          await execAsync(`wmctrl -ia ${winId}`)
        } else {
          console.warn(`⚠️ No window found for "${appName}"`)
        }
      } catch (e) {
        console.error(`❌ Could not bring ${appName} to front (Linux):`, e)
      }
    } else {
      console.warn('⚠️ focusApp is not supported on this platform.')
    }
  }

  async quitApp(appName: string): Promise<void> {
    try {
      await execAsync(`pkill -f "${appName}"`)
      console.log(`✅ Quit app: ${appName}`)
    } catch (e) {
      console.error(`❌ Could not quit "${appName}":`, e)
    }
  }

  async openApp(appPath: string): Promise<void> {
    try {
      await execAsync(`"${appPath}" &`)
      console.log(`✅ Opened app: ${appPath}`)
    } catch (e) {
      console.error(`❌ Could not open "${appPath}":`, e)
    }
  }

  async wait(ms: number): Promise<any> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
