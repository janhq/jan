import appPage from '../pageobjects/app.page.js'

describe('App Launch and Basic UI', () => {
  before(async () => {
    // Wait for the app to fully load
    await appPage.waitForAppToLoad()
  })

  it('should launch the Jan application successfully', async () => {
    // Verify the app container is visible
    const isAppVisible = await appPage.elementExists(appPage.appContainer)
    expect(isAppVisible).toBe(true)
  })

  it('should display correct app title and branding', async () => {
    const titleInfo = await appPage.verifyAppTitle()
    
    // Check if "Jan" appears in the page title or UI
    const hasJanBranding = titleInfo.hasJanInTitle || 
                          titleInfo.brandingElements.some(el => 
                            el.text.toLowerCase().includes('jan'))
    
    expect(hasJanBranding).toBe(true)
  })

  it('should have main UI layout elements visible', async () => {
    const layoutResults = await appPage.verifyMainLayout()
    
    // At least the app container should exist and be visible
    const appContainer = layoutResults.find(el => el.name === 'app container')
    expect(appContainer?.exists).toBe(true)
    expect(appContainer?.visible).toBe(true)
    
    // Either sidebar or main content should be visible (flexible for different layouts)
    const hasVisibleContent = layoutResults.some(el => 
      (el.name === 'sidebar' || el.name === 'main content') && el.visible)
    expect(hasVisibleContent).toBe(true)
  })

  it('should have interactive elements that are clickable', async () => {
    const responsiveness = await appPage.verifyAppResponsiveness()
    
    // Should have at least some clickable elements
    expect(responsiveness.totalClickableElements).toBeGreaterThan(0)
  })

  after(async () => {
    // Take a screenshot for debugging if needed
    if (process.env.SCREENSHOT_ON_COMPLETE === 'true') {
      await appPage.takeScreenshot('app-launch-complete')
    }
  })
})