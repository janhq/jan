import time from '../data/timeout_data.json'
import { String } from 'typescript-string-operations'
export type BaseElements = {
  text: string
  textContains: string
}
export default class BasePage {
  public elementsCom: BaseElements
  constructor() {
    this.elementsCom = {
      text: `//*[text()="{0}"]`,
      textContains: `//*[contains(text(), "{0}")]`,
    }
  }

  async wait(timeout: number = time.normal): Promise<void> {
    await browser.pause(timeout)
  }

  async waitFor(
    selector: string,
    timeout: number = time.normal
  ): Promise<void> {
    await browser.waitUntil(
      async () => {
        const element = await browser.$(selector)
        return await element.isDisplayed()
      },
      {
        timeout,
        timeoutMsg: `Element with selector "${selector}" not visible after ${timeout} ms`,
      }
    )
  }

  async isDisplayed(
    selector: string,
    timeout: number = time.normal
  ): Promise<boolean> {
    try {
      const el = await $(selector)
      await el.waitForDisplayed({ timeout })
      return true
    } catch {
      return false
    }
  }

  async click(selector: string, timeout: number = time.normal): Promise<void> {
    const el = await $(selector)
    await el.click()
  }

  async clickElementByCoordinates(
    selector: string,
    addCenterX = 0,
    addCenterY = 0
  ): Promise<void> {
    const element = await $(selector)
    // await element.waitForDisplayed({ timeout: 5000 })
    // const rect = await element.getRect()
    // const centerX = Math.round(rect.x + rect.width / 2) + addCenterX
    // const centerY = Math.round(rect.y + rect.height / 2) + addCenterY
    // await browser.performActions([
    //   {
    //     type: 'pointer',
    //     id: 'mouse',
    //     parameters: { pointerType: 'mouse' },
    //     actions: [
    //       { type: 'pointerMove', duration: 0, x: centerX, y: centerY },
    //       { type: 'pointerDown', button: 0 },
    //       { type: 'pointerUp', button: 0 },
    //     ],
    //   },
    // ])
    // await browser.releaseActions()
  }

  async clickAtPoint(offsetX = 0, offsetY = 0): Promise<void> {
    await browser
      .action('pointer')
      .move({ x: offsetX, y: offsetY, duration: 100, origin: 'viewport' })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform()
  }

  async enterText(
    selector: string,
    text: string,
    timeout: number = time.normal
  ): Promise<void> {
    const el = await $(selector)
    await el.setValue(text)
  }

  async getText(
    selector: string,
    timeout: number = time.normal
  ): Promise<string> {
    const el = await $(selector)
    return await el.getText()
  }

  async getValue(
    selector: string,
    timeout: number = time.normal
  ): Promise<string> {
    const el = await $(selector)
    return await el.getAttribute('value')
  }

  async scrollElementIntoView(selector: string): Promise<void> {
    const el = await $(selector)
    await browser.execute((element) => {
      element.scrollIntoView(true)
    }, el)
  }
  async getAttribute(selector: string, attr: string): Promise<any> {
    const el = await $(selector)
    return await el.getAttribute(attr)
  }

  async waitUntilElementIsVisible(
    selector: string,
    timeout = 5000
  ): Promise<void> {
    const el = await $(selector)
    await el.waitForDisplayed({ timeout })
  }

  async count(selector: string): Promise<number> {
    const elements = await $$(selector)
    return elements.length
  }

  async isText(text: string): Promise<boolean> {
    const selector = String.format(this.elementsCom.text, text)
    return await this.isDisplayed(selector)
  }

  async isTextContains(text: string): Promise<boolean> {
    const selector = String.format(this.elementsCom.textContains, text)
    return await this.isDisplayed(selector)
  }

  async waitText(text: string, timeout?: number): Promise<void> {
    const selector = String.format(this.elementsCom.text, text)
    await this.waitUntilElementIsVisible(selector, timeout)
  }

  async waitTextContains(text: string, timeout?: number): Promise<void> {
    const selector = String.format(this.elementsCom.textContains, text)
    await this.waitUntilElementIsVisible(selector, timeout)
  }

  async isNotify(title: string, details: string): Promise<boolean> {
    try {
      const titleLocator = String.format(this.elementsCom.text, title)
      await this.waitUntilElementIsVisible(titleLocator)
      if (details) {
        const detailsLocator = String.format(this.elementsCom.text, details)
        await this.waitUntilElementIsVisible(detailsLocator)
      }
      return true
    } catch (e) {
      console.error('Notify not displayed:', e)
      return false
    }
  }

  async pasteText(): Promise<void> {
    await browser.keys(['Control', 'v'])
  }

  async tapText(text: string): Promise<void> {
    const selector = String.format(this.elementsCom.text, text)
    await this.click(selector)
  }

  async getBrowserUrl(browser: string = 'Chrome'): Promise<any> {}

  async focusApp(appName: string): Promise<void> {}

  async quitApp(appName: string): Promise<void> {}

  async openApp(appPath: string): Promise<void> {}
}
