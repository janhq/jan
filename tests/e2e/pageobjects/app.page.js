import BasePage from './base.page.js'

/**
 * Main app page object
 */
class AppPage extends BasePage {
  // Selectors - Exact selectors from Jan app codebase
  get appContainer() { return '#root' }
  get mainElement() { return 'main.relative.h-svh.text-sm.antialiased.select-none.bg-app' }
  get sidebar() { return 'aside.text-left-panel-fg.overflow-hidden' }
  get mainContent() { return '.bg-main-view.text-main-view-fg.border.border-main-view-fg\\/5.w-full.h-full.rounded-lg.overflow-hidden' }
  get sidebarToggle() { return 'button svg.tabler-icon-layout-sidebar' }
  get dragRegion() { return '[data-tauri-drag-region]' }

  /**
   * Wait for app to be fully loaded
   */
  async waitForAppToLoad() {
    await this.waitForAppLoad()
    
    // Wait for essential UI elements
    await this.waitForElement(this.appContainer, 15000)
    await browser.pause(3000) // Give the app additional time to initialize
  }

  /**
   * Verify app title and branding
   */
  async verifyAppTitle() {
    // Check page title
    const pageTitle = await browser.getTitle()
    
    // Check for Jan branding in various places
    const brandingSelectors = [
      this.title,
      this.logo,
      '[data-testid="app-name"]',
      'h1:contains("Jan")',
      'span:contains("Jan")'
    ]

    const brandingFound = []
    for (const selector of brandingSelectors) {
      if (await this.elementExists(selector)) {
        try {
          const text = await this.getElementText(selector)
          brandingFound.push({ selector, text })
        } catch (error) {
          // Skip if can't get text
        }
      }
    }

    return {
      pageTitle,
      brandingElements: brandingFound,
      hasJanInTitle: pageTitle.toLowerCase().includes('jan')
    }
  }

  /**
   * Verify main UI layout
   */
  async verifyMainLayout() {
    const layoutElements = [
      { selector: this.appContainer, name: 'app container' },
      { selector: this.sidebar, name: 'sidebar' },
      { selector: this.mainContent, name: 'main content' }
    ]

    const results = []
    for (const element of layoutElements) {
      const exists = await this.elementExists(element.selector)
      const visible = exists ? await $(element.selector).then(el => el.isDisplayed()) : false
      
      results.push({
        name: element.name,
        exists,
        visible
      })
    }

    return results
  }

  /**
   * Get app version info if available
   */
  async getAppVersion() {
    const versionSelectors = [
      '[data-testid="version"]',
      '.version',
      '[data-version]',
      'span:contains("v")',
      'div:contains("version")'
    ]

    for (const selector of versionSelectors) {
      if (await this.elementExists(selector)) {
        try {
          const text = await this.getElementText(selector)
          if (text.match(/v?\d+\.\d+\.\d+/)) {
            return text
          }
        } catch (error) {
          // Continue to next selector
        }
      }
    }

    return null
  }

  /**
   * Take screenshot for debugging
   */
  async takeScreenshot(name = 'debug') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await browser.saveScreenshot(`./screenshots/${name}-${timestamp}.png`)
  }

  /**
   * Verify app is responsive and functional
   */
  async verifyAppResponsiveness() {
    // Check if main elements are clickable and responsive
    const interactiveElements = [
      this.sidebar,
      '[data-testid="new-chat"]',
      '[data-testid="settings-button"]',
      'button',
      'a'
    ]

    const clickableElements = []
    for (const selector of interactiveElements) {
      if (await this.elementExists(selector)) {
        try {
          const element = await $(selector)
          const isClickable = await element.isClickable()
          if (isClickable) {
            clickableElements.push(selector)
          }
        } catch (error) {
          // Skip if element is not accessible
        }
      }
    }

    return {
      totalClickableElements: clickableElements.length,
      clickableElements
    }
  }
}

export default new AppPage()