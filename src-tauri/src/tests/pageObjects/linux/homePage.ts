import { HomePageElements, IHomePage } from '@interface/iHomePage'
import BasePage from '@linux/basePage'
import { Browser } from 'webdriverio'

export class HomePage extends BasePage implements IHomePage {
  elements: HomePageElements

  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      welcomeMessage: `//*[text()="Welcome to Jan" or @name="Welcome to Jan"]`,
      getStartedText: `//*[text()="To get started, you’ll need to either download a local AI model or connect to a cloud model using an API key" or @name="To get started, you’ll need to either download a local AI model or connect to a cloud model using an API key"]`,
      setupLocalModelButton: `//*[text()="Setup Local Model" or @name="Setup Local Model"]`,
      setupRemoteProviderButton: `//*[text()="Setup Remote Provider" or @name="Setup Remote Provider"]`,
      newChatButton: `//*[text()="New Chat" or @name="New Chat"]`,
      assistantsButton: `//*[text()="Assistants" or @name="Assistants"]`,
      settingsButton: `//*[text()="Settings" or @name="Settings"]`,
      searchInput: `//input[@placeholder="Search"]`,
      searchResultTitle: `//*[text()="__TEXT__" or @name="__TEXT__"]`,
      hubButton: `//*[text()="Hub" or @name="Hub"]`,
      menuMoreButton: `//*[text()="Recents" or @name="Recents"]/following-sibling::*[contains(@class, "popup") or @role="menu" or name()="button"]`,
      deleteAllButton: `//*[text()="Delete All" or @name="Delete All"]`,
      deleteAllThreadsTitle: `//*[text()="Delete All Threads" or @name="Delete All Threads"]`,
      deleteAllThreadsText: `//*[text()="All threads will be deleted. This action cannot be undone." or @name="All threads will be deleted. This action cannot be undone."]`,
      deleteButton: `//button[@name="Delete" or text()="Delete"]`,
      cancelButton: `//button[@name="Cancel" or text()="Cancel"]`,
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
