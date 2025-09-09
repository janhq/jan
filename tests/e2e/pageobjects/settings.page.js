import BasePage from './base.page.js'

/**
 * Settings page object
 */
class SettingsPage extends BasePage {
  // Selectors - Exact selectors from Jan app codebase
  get settingsButton() { return '[data-test-id="menu-common:settings"]' }
  get settingsButtonFallback() { return 'a[href="/settings/general"] svg.tabler-icon-settings-filled' }
  get appearanceTab() { return 'a[href*="appearance"]' }
  get themeSelector() { return 'span[title="Edit theme"].flex.cursor-pointer.items-center.gap-1.px-2.py-1.rounded-sm.bg-main-view-fg\\/15.text-sm' }
  get themeDropdownContent() { return 'div[role="menu"].w-24' }
  get themeOption() { return 'div[role="menuitem"].cursor-pointer.my-0\\.5' }
  get darkThemeOption() { return 'div[role="menuitem"]:contains("Dark")' }
  get lightThemeOption() { return 'div[role="menuitem"]:contains("Light")' }
  get systemThemeOption() { return 'div[role="menuitem"]:contains("System")' }
  get resetButton() { return 'button:contains("Reset")' }

  /**
   * Navigate to settings
   */
  async navigateToSettings() {
    // Try primary selector first, then fallback
    if (await this.elementExists(this.settingsButton)) {
      await this.clickElement(this.settingsButton)
    } else if (await this.elementExists(this.settingsButtonFallback)) {
      await this.clickElement(this.settingsButtonFallback)
    }
    await browser.pause(1000) // Wait for settings to load
  }

  /**
   * Navigate to appearance settings
   */
  async navigateToAppearance() {
    await this.navigateToSettings()
    if (await this.elementExists(this.appearanceTab)) {
      await this.clickElement(this.appearanceTab)
      await browser.pause(500)
    }
  }

  /**
   * Change theme
   * @param {string} theme - Theme option ('light', 'dark', 'system')
   */
  async changeTheme(theme) {
    await this.navigateToAppearance()
    
    // Try different approaches to change theme
    const themeSelectors = [
      this.themeSelector,
      `[data-value="${theme}"]`,
      `button:contains("${theme}")`,
      `input[value="${theme}"]`
    ]

    for (const selector of themeSelectors) {
      if (await this.elementExists(selector)) {
        await this.clickElement(selector)
        break
      }
    }

    // If there's a save button, click it
    if (await this.elementExists(this.saveButton)) {
      await this.clickElement(this.saveButton)
    }
    
    await browser.pause(1000) // Wait for theme to apply
  }

  /**
   * Get current theme from UI elements
   */
  async getCurrentTheme() {
    // Check body/html classes or data attributes for theme
    const body = await $('body')
    const bodyClass = await body.getAttribute('class') || ''
    const dataTheme = await body.getAttribute('data-theme') || ''
    
    if (bodyClass.includes('dark') || dataTheme.includes('dark')) return 'dark'
    if (bodyClass.includes('light') || dataTheme.includes('light')) return 'light'
    
    // Check for common theme indicators
    const html = await $('html')
    const htmlClass = await html.getAttribute('class') || ''
    if (htmlClass.includes('dark')) return 'dark'
    if (htmlClass.includes('light')) return 'light'
    
    return 'unknown'
  }

  /**
   * Verify theme is applied by checking background colors
   */
  async verifyThemeApplied(expectedTheme) {
    await browser.pause(1000) // Wait for theme to fully apply
    
    // Check background color of main elements
    const selectors = ['body', 'html', '[data-testid="main-container"]', '.app', '#root']
    
    for (const selector of selectors) {
      if (await this.elementExists(selector)) {
        const bgColor = await this.getCSSProperty(selector, 'background-color')
        const color = bgColor.value
        
        // Light theme typically has light backgrounds (white, light gray)
        // Dark theme typically has dark backgrounds (black, dark gray)
        if (expectedTheme === 'light') {
          // Light theme: background should be light (high RGB values or white)
          return color.includes('255') || color.includes('rgb(255') || color === 'rgba(0,0,0,0)'
        } else if (expectedTheme === 'dark') {
          // Dark theme: background should be dark (low RGB values)
          return color.includes('rgb(0') || color.includes('rgb(1') || color.includes('rgb(2') || 
                 color.includes('33') || color.includes('51') || color.includes('68')
        }
      }
    }
    
    return false
  }
}

export default new SettingsPage()