/**
 * Base page containing common methods and functionality
 */
class BasePage {
  /**
   * Wait for an element to be displayed
   * @param {string} selector - Element selector
   * @param {number} timeout - Timeout in milliseconds
   */
  async waitForElement(selector, timeout = 10000) {
    const element = await $(selector)
    await element.waitForDisplayed({ timeout })
    return element
  }

  /**
   * Click an element
   * @param {string} selector - Element selector
   */
  async clickElement(selector) {
    const element = await this.waitForElement(selector)
    await element.click()
  }

  /**
   * Get element text
   * @param {string} selector - Element selector
   */
  async getElementText(selector) {
    const element = await this.waitForElement(selector)
    return await element.getText()
  }

  /**
   * Check if element exists
   * @param {string} selector - Element selector
   */
  async elementExists(selector) {
    try {
      const element = await $(selector)
      return await element.isExisting()
    } catch (error) {
      return false
    }
  }

  /**
   * Get CSS property value
   * @param {string} selector - Element selector
   * @param {string} property - CSS property name
   */
  async getCSSProperty(selector, property) {
    const element = await this.waitForElement(selector)
    return await element.getCSSProperty(property)
  }

  /**
   * Wait for the app to load
   */
  async waitForAppLoad() {
    // Wait for the main app container to be visible - exact Jan app structure
    await browser.pause(3000) // Give the app time to initialize
    await this.waitForElement('#root', 15000)
    // Wait for main app element to be fully rendered
    await this.waitForElement('main.relative.h-svh.text-sm.antialiased.select-none.bg-app', 10000)
  }
}

export default BasePage