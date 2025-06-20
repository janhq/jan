import { HomePageElements, IHomePage } from '@interface/iHomePage'
import BasePage from '@mac/basePage'
import { Browser } from 'webdriverio'

export class HomePage extends BasePage implements IHomePage {
  elements: HomePageElements

  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      welcomeMessage: `//XCUIElementTypeStaticText[@value="Welcome to Jan"]`,
      getStartedText: `//XCUIElementTypeStaticText[@value="To get started, you’ll need to either download a local AI model or connect to a cloud model using an API key"]`,
      setupLocalModelButton: `//XCUIElementTypeStaticText[@value="Setup Local Model"]`,
      setupRemoteProviderButton: `//XCUIElementTypeStaticText[@value="Setup Remote Provider"]`,
      newChatButton: `//XCUIElementTypeStaticText[@value="New Chat"]`,
      assistantsButton: `//XCUIElementTypeStaticText[@value="Assistants"]`,
      settingsButton: `//XCUIElementTypeStaticText[@value="Settings"]`,
      searchInput: `//XCUIElementTypeTextField[@placeholderValue="Search"]`,
      searchResultTitle: `//XCUIElementTypeStaticText[@value="__TEXT__"]`,
      hubButton: `//XCUIElementTypeStaticText[@value="Hub"]`,
      menuMoreButton: `//XCUIElementTypeStaticText[@value="Recents"]/following-sibling::XCUIElementTypePopUpButton`,
      deleteAllButton: `//XCUIElementTypeStaticText[@value="Delete All"]`,
      deleteAllThreadsTitle: `//XCUIElementTypeStaticText[@value="Delete All Threads"]`,
      deleteAllThreadsText: `//XCUIElementTypeStaticText[@value="All threads will be deleted. This action cannot be undone."]`,
      deleteButton: `//XCUIElementTypeButton[@title="Delete"]`,
      cancelButton: `//XCUIElementTypeButton[@title="Cancel"]`,
    }
  }

  async openNewChat(): Promise<void> {
    await this.clickElement(this.elements.newChatButton)
  }

  async openAssistants(): Promise<void> {
    await this.clickElement(this.elements.assistantsButton)
  }

  async openHub(): Promise<void> {
    await this.clickElement(this.elements.hubButton)
  }

  async openSettings(): Promise<void> {
    await this.waitForTimeout(1000)
    await this.clickElement(this.elements.settingsButton)
  }

  async searchThreads(searchText: string): Promise<void> {
    await this.enterText(this.elements.searchInput, searchText)
  }

  async verifySearchResultTitle(resultTitle: string): Promise<void> {
    const searchResult = this.elements.searchResultTitle.replace(
      `__TEXT__`,
      resultTitle
    )
    const result = await this.elementShouldBeVisible(searchResult)
    if (!result) {
      throw new Error(`Search result title "${resultTitle}" is not visible`)
    }
  }
}
