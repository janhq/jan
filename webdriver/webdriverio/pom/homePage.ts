import type { Browser } from 'webdriverio'
import BasePage from './basePage'
export type HomeElements = {
  welcomeMessage: string
  getStartedText: string
  setupLocalModelButton: string
  setupRemoteProviderButton: string
  newChatButton: string
  assistantsButton: string
  settingsButton: string
  searchInput: string
  searchResultTitle: string
  hubButton: string
  menuMoreButton: string
  deleteAllButton: string
  deleteAllThreadsTitle: string
  deleteAllThreadsText: string
  deleteButton: string
  cancelButton: string
}
export class HomePage extends BasePage {
  elements: HomeElements
  constructor() {
    super()
    this.elements = {
      welcomeMessage: `//*[text()="Welcome to Jan"]`,
      getStartedText: `//*[text()="To get started, you’ll need to either download a local AI model or connect to a cloud model using an API key"]`,
      setupLocalModelButton: `//*[text()="Setup Local Model"]`,
      setupRemoteProviderButton: `//*[text()="Setup Remote Provider"]`,
      newChatButton: `//a/span[text()="New Chat"]`,
      assistantsButton: `//a/span[text()="Assistants"]`,
      settingsButton: `//a/span[text()="Settings"]`,
      searchInput: `//input[@placeholder="Search"]`,
      searchResultTitle: `//*[text()="__TEXT__"]`,
      hubButton: `//a/span[text()="Hub"]`,
      menuMoreButton: `//*[text()="Recents"]/following-sibling::*[@AutomationId="MoreMenu"]`,
      deleteAllButton: `//*[text()="Delete All"]`,
      deleteAllThreadsTitle: `//*[text()="Delete All Threads"]`,
      deleteAllThreadsText: `//*[text()="All threads will be deleted. This action cannot be undone."]`,
      deleteButton: `//*[text()="Delete"]`,
      cancelButton: `//*[text()="Cancel"]`,
    }
  }

  async openNewChat(): Promise<void> {
    await this.click(this.elements.newChatButton)
  }

  async openAssistants(): Promise<void> {
    await this.click(this.elements.assistantsButton)
  }

  async openHub(): Promise<void> {
    await this.click(this.elements.hubButton)
  }

  async openSettings(): Promise<void> {
    await this.wait(1000)
    await this.click(this.elements.settingsButton)
  }

  async searchThreads(searchText: string): Promise<void> {
    await this.enterText(this.elements.searchInput, searchText)
  }

  async verifySearchResultTitle(resultTitle: string): Promise<void> {
    const searchResult = this.elements.searchResultTitle.replace(
      `__TEXT__`,
      resultTitle
    )
    const result = await this.isDisplayed(searchResult)
    if (!result) {
      throw new Error(`Search result title "${resultTitle}" is not visible`)
    }
  }
}
