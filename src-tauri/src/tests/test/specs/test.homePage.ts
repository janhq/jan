import * as dotenv from 'dotenv'
// interface
import { IHomePage } from '@interface/iHomePage'
// mac
import { HomePage as MacHomePage } from '@mac/homePage'
// win
import { HomePage as WinHomePage } from '@win/homePage'
// linux
import { HomePage as LinuxHomePage } from '@linux/homePage'
dotenv.config()

let homePage: IHomePage

describe('Verify Jan Homepage', () => {
  before(async () => {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(driver)
    } else if (process.env.RUNNING_OS === 'win') {
      homePage = new WinHomePage(driver)
    } else if (process.env.RUNNING_OS === 'linux') {
      homePage = new LinuxHomePage(driver)
    }
    await homePage.activateApp(process.env.BUNDLE_ID)
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
    await homePage.setWindowBounds()
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
