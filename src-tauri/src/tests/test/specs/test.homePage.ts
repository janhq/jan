import * as dotenv from 'dotenv'
import { IHomePage } from '../../pageObjects/interface/iHomePage'
import { HomePage as MacHomePage } from '../../pageObjects/mac/homePage'
import Flow from '../../pageObjects/flow/flow'
import common from '@data/common.json'
dotenv.config()

let homePage: IHomePage
const flow = new Flow()
let models = common.models

describe('Verify Jan Homepage', () => {
  before(async () => {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(driver)
    }
    await homePage.activateApp(process.env.BUNDLE_ID)
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
    await homePage.setWindowBounds()
    await flow.checkAndDownloadModels(driver, [
      models.qwen3v0dot6b,
      models.qwen3v1dot7b,
      models.qwen3v4b,
    ])
    await homePage.openNewChat()
  })

  it('should open the app and see welcome message', async () => {
    for (const [key, element] of Object.entries(homePage.elements)) {
      console.log(`Verifying element: ${key} is visible`)
      await homePage.elementShouldBeVisible(element)
    }
  })

  it('user should be able to open new chat', async () => {
    await homePage.openNewChat()
    const result = await homePage.elementShouldBeVisible(
      homePage.elements.newChatButton
    )
    expect(result).toBeTruthy()
  })

  it('user should be able to open assistants', async () => {
    await homePage.openAssistants()
    const result = await homePage.elementShouldBeVisible(
      homePage.elements.assistantsButton
    )
    expect(result).toBeTruthy()
  })

  it('user should be able to search threads', async () => {
    await homePage.elementShouldBeVisible(homePage.elements.searchInput)
    await homePage.searchThreads('Something to search')
    await homePage.verifySearchResultTitle('No results found')
  })
})
