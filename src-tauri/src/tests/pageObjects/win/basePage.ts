import { ElementReference } from '@wdio/protocols'
import { IBasePage, BaseElements } from '@interface/iBasePage'
import { Browser } from 'webdriverio'
import { String as TString } from 'typescript-string-operations'
import { exec } from 'child_process'
import util from 'util'
const execPromise = util.promisify(exec)
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
    const el = await this.driver.$(selector)
    await el.click()
  }

  async clickElementByCoordinates(
    selector: string,
    addCenterX: number = 0,
    addCenterY: number = 0
  ): Promise<void> {
    await this.waitUntilElementIsVisible(selector)
    const element = await this.getElement(selector)
    const rect = await element.getRect()
    const centerX = Math.round(rect.x + rect.width / 2)
    const centerY = Math.round(rect.y + rect.height / 2)
    const driver = this.driver as any
    await driver.performActions([
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 0,
            x: centerX + addCenterX,
            y: centerY + addCenterY,
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ])
    await driver.releaseActions()
  }

  async clickAtPoint(x: number, y: number): Promise<void> {
    const driver = this.driver as any
    await driver.performActions([
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', duration: 2, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ])
    await driver.releaseActions()
  }

  async scrollToElement(selector: string): Promise<void> {
    const element = await this.driver.$(selector)
    await this.driver.execute(function (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, element)
  }

  async sendKeys(selector: string, keys: string): Promise<void> {
    await this.clickElement(selector)
    const element = await this.driver.$(selector)
    await element.addValue(keys)
  }

  async enterText(selector: string, text: string): Promise<void> {
    const el = await this.driver.$(selector)
    await el.setValue(text)
  }

  async terminateApp(appName?: string): Promise<void> {
    if (!appName) appName = process.env.APP_NAME
    execSync(`taskkill /IM ${appName}.exe /F`)
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await this.driver.pause(timeout)
  }

  public async activateApp(appPath?: string): Promise<void> {
    if (!appPath) appPath = process.env.APP_PATH
    execSync(`start "" "${appPath}"`)
  }

  async elementShouldBeVisible(selector: string): Promise<boolean> {
    const els = await this.driver.$$(selector)
    return (await els.length) > 0
  }

  async waitUntilElementIsVisible(
    selector: string,
    timeout: number = 5000
  ): Promise<void> {
    const el = await this.driver.$(selector)
    await el.waitForDisplayed({ timeout })
  }

  async getActiveWindowName(): Promise<string> {
    try {
      const output = execSync(
        `powershell -command "(Get-Process | Where-Object { $_.MainWindowTitle }).MainWindowTitle"`
      ).toString()
      return output.trim()
    } catch (e) {
      throw new Error('Failed to get active window name')
    }
  }

  async setWindowBounds(
    top = 50,
    left = 50,
    width = 1800,
    height = 900
  ): Promise<void> {
    const script = `
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class WinAPI {
        [DllImport("user32.dll")]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        [DllImport("user32.dll")]
        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    }
"@
    $hwnd = [WinAPI]::FindWindow($null, "Jan")  # Replace "Jan" with your actual app title
    [WinAPI]::MoveWindow($hwnd, ${left}, ${top}, ${width}, ${height}, $true)
  `
    try {
      await execPromise(`powershell -Command "${script}"`)
    } catch (err) {
      console.error('Failed to move window:', err)
    }
  }

  async uploadFile(filePath: string): Promise<boolean> {
    try {
      execSync(
        `powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\"^o\"); Start-Sleep -Seconds 1; [System.Windows.Forms.SendKeys]::SendWait(\"${filePath}\"); Start-Sleep -Seconds 1; [System.Windows.Forms.SendKeys]::SendWait(\"{ENTER}\")"`
      )
      return true
    } catch (e) {
      console.error('Upload failed:', e)
      return false
    }
  }

  async getText(selector: string): Promise<string> {
    const el = await this.driver.$(selector)
    return await el.getText()
  }

  async getAttribute(selector: string, attribute: string): Promise<string> {
    const element = await this.driver.$(selector)
    return await element.getAttribute(attribute)
  }

  async count(selector: string): Promise<number> {
    const els = await this.driver.$$(selector)
    return els.length
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
    } catch (e) {
      console.error('Notify not displayed:', e)
      return false
    }
  }

  async pasteText(): Promise<void> {
    await this.driver.keys(['Control', 'v'])
  }

  async tapText(text: string): Promise<void> {
    const selector = TString.format(this.elementsCom.text, text)
    await this.clickElement(selector)
  }

  async getBrowserUrl(browser: string = 'Chrome'): Promise<string> {
    try {
      const script =
        browser === 'Chrome'
          ? `powershell -command "(Get-Process chrome | Where-Object { $_.MainWindowTitle }) | Select-Object -ExpandProperty MainWindowTitle"`
          : ''
      return execSync(script).toString().trim()
    } catch (e) {
      console.error('Failed to get browser URL:', e)
      return ''
    }
  }

  async focusApp(appName: string): Promise<void> {
    try {
      execSync(
        `powershell -command "(Get-Process -Name ${appName}).MainWindowHandle | ForEach-Object { [void][System.Runtime.Interopservices.Marshal]::PtrToStructure($_, [System.IntPtr]); }"`
      )
    } catch (e) {
      console.error(`Could not focus ${appName}:`, e)
    }
  }

  async quitApp(appName: string): Promise<void> {
    try {
      execSync(`taskkill /IM ${appName}.exe /F`)
    } catch (e) {
      console.error(`Could not quit ${appName}:`, e)
    }
  }

  async openApp(appPath: string): Promise<void> {
    try {
      execSync(`start "" "${appPath}"`)
    } catch (e) {
      console.error(`Could not open ${appPath}:`, e)
    }
  }

  async wait(ms: number): Promise<any> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
