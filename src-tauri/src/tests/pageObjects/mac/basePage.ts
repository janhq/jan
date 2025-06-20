import { ElementReference } from '@wdio/protocols'
import { IBasePage, BaseElements } from '@interface/iBasePage'
import { Browser } from 'webdriverio'
import { String as TString } from 'typescript-string-operations'
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
    return await this.driver.findElement('xpath', selector)
  }

  async clickElement(selector: string): Promise<void> {
    await this.waitUntilElementIsVisible(selector)
    const element = await this.getElement(selector)
    const elementId = element['element-6066-11e4-a52e-4f735466cecf']
    try {
      await this.driver.executeScript('macos: click', [{ elementId }])
    } catch (err) {
      console.error('⚠️ macos: click failed, fallback to element.click()', err)
    }
  }

  async clickElementByCoordinates(
    selector: string,
    addCenterX: number = 0,
    addCenterY: number = 0
  ): Promise<void> {
    await this.waitUntilElementIsVisible(selector)
    const element = await this.getElement(selector)
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
    const element = await this.getElement(selector)
    await this.driver.executeScript('macos: scrollTo', [
      {
        elementId: element['element-6066-11e4-a52e-4f735466cecf'],
      },
    ])
  }

  async sendKeys(selector: string, keys: string): Promise<void> {
    await this.clickElement(selector)
    const element = await this.getElement(selector)
    // Cast keys to string and add each letter to an array
    const keysStr = String(keys)
    const keysArray = keysStr.split('')
    await this.driver.executeScript('macos: keys', [
      {
        elementId: element['element-6066-11e4-a52e-4f735466cecf'],
        keys: keysArray,
      },
    ])
  }

  async enterText(selector: string, text: string): Promise<void> {
    const element = await driver.$(selector)
    await element.setValue(text)
  }

  async terminateApp(bundleId?: string): Promise<void> {
    if (!bundleId) {
      bundleId = process.env.BUNDLE_ID
    }

    await this.driver.executeScript('macos: terminateApp', [
      {
        bundleId: bundleId,
        path: process.env.APP_PATH,
      },
    ])
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await this.driver.pause(timeout)
  }

  public async activateApp(bundleId?: string): Promise<void> {
    if (!bundleId) {
      bundleId = process.env.BUNDLE_ID
    }

    await this.driver.executeScript('macos: activateApp', [
      {
        bundleId: bundleId,
        path: process.env.APP_PATH,
      },
    ])
  }

  async elementShouldBeVisible(selector: string): Promise<boolean> {
    const element = await this.getElement(selector)
    try {
      return !!element['element-6066-11e4-a52e-4f735466cecf']
    } catch (error) {
      return false
    }
  }

  async waitUntilElementIsVisible(
    selector: string,
    timeout: number = 5000
  ): Promise<void> {
    await this.driver.waitUntil(
      async () => {
        try {
          const element = await this.getElement(selector)
          return !!element['element-6066-11e4-a52e-4f735466cecf']
        } catch (error) {
          return false
        }
      },
      { timeout }
    )
  }

  async getActiveWindowName(): Promise<string> {
    const appName = await this.driver.execute('macos: appleScript', {
      script: `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
        end tell
        return frontApp
      `,
    })
    if (typeof appName !== 'string') {
      throw new Error('Failed to get active window name')
    }
    return appName
  }

  async setWindowBounds(
    top: number = 50,
    left: number = 50,
    width: number = 1800,
    height: number = 900
  ): Promise<void> {
    const appName = await this.getActiveWindowName()
    await this.driver.execute('macos: appleScript', {
      script: `
        tell application "System Events"
          tell process "${appName.trim()}"
            set frontmost to true
            tell window 1
              set position to {${top}, ${left}}
              set size to {${width}, ${height}}
            end tell
          end tell
        end tell
      `,
    })
  }

  async uploadFile(filePath: string): Promise<boolean> {
    try {
      await this.driver.execute('macos: appleScript', {
        script: `
        tell application "System Events"
          delay 1
          keystroke "G" using {command down, shift down}
          delay 1
          keystroke "${filePath}"
          delay 0.5
          keystroke return
          delay 0.5
          keystroke return
        end tell
      `,
      })
      return true
    } catch (error) {
      console.error('File upload failed:', error)
      return false
    }
  }

  async getText(selector: string): Promise<string> {
    const element = await driver.$(selector)
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
    const element = await driver.$(selector)
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
    await this.driver.execute('macos: appleScript', {
      script: `
      tell application "System Events"
        keystroke "v" using command down
      end tell
    `,
    })
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
    try {
      const script = `
      tell application "${appName}"
        activate
      end tell
    `
      execSync(`osascript -e '${script}'`)
    } catch (e) {
      console.error(`Could not bring ${appName} to front:`, e)
    }
  }

  async quitApp(appName: string): Promise<void> {
    try {
      const script = `
        tell application "${appName}"
          quit
        end tell
      `
      execSync(`osascript -e '${script}'`)
    } catch (e) {
      console.error(`Could not quit ${appName}:`, e)
    }
  }

  async openApp(appPath: string): Promise<void> {
    try {
      execSync(`open "${appPath}"`)
    } catch (e) {
      console.error(`Could not open ${appPath}:`, e)
    }
  }

  async wait(ms: number): Promise<any> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
