// interface
import { HomePageElements, IHomePage } from '@interface/iHomePage'
import BasePage from '@win/basePage'
import { Browser } from 'webdriverio'

export class HomePage extends BasePage implements IHomePage {
  elements: HomePageElements

  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      welcomeMessage: `//*[@Name="Welcome to Jan" and @ClassName="TextBlock"]`,
      getStartedText: `//*[@Name="To get started, you’ll need to either download a local AI model or connect to a cloud model using an API key"]`,
      setupLocalModelButton: `//*[@Name="Setup Local Model"]`,
      setupRemoteProviderButton: `//*[@Name="Setup Remote Provider"]`,
      newChatButton: `//*[@Name="New Chat"]`,
      assistantsButton: `//*[@Name="Assistants"]`,
      settingsButton: `//*[@Name="Settings"]`,
      searchInput: `//Edit[@Name="Search"]`,
      searchResultTitle: `//*[@Name="__TEXT__"]`,
      hubButton: `//*[@Name="Hub"]`,
      menuMoreButton: `//*[@Name="Recents"]/following-sibling::*[@AutomationId="MoreMenu"]`,
      deleteAllButton: `//*[@Name="Delete All"]`,
      deleteAllThreadsTitle: `//*[@Name="Delete All Threads"]`,
      deleteAllThreadsText: `//*[@Name="All threads will be deleted. This action cannot be undone."]`,
      deleteButton: `//*[@Name="Delete"]`,
      cancelButton: `//*[@Name="Cancel"]`,
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
