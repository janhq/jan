import * as dotenv from 'dotenv'
// interface
import { IHomePage } from '@interface/iHomePage'
import { IHubPage } from '@interface/iHubPage'
import { IChatPage } from '@interface/iChatPage'
// mac
import { HomePage as MacHomePage } from '@mac/homePage'
import { HubPage as MacHubPage } from '@mac/hubPage'
import { ChatPage as MacChatPage } from '@win/chatPage'
// win
import { HomePage as WinHomePage } from '@win/homePage'
import { HubPage as WinHubPage } from '@win/hubPage'
import { ChatPage as WinChatPage } from '@win/chatPage'
// linux
import { HomePage as LinuxHomePage } from '@linux/homePage'
import { HubPage as LinuxHubPage } from '@linux/hubPage'
import { ChatPage as LinuxChatPage } from '@linux/chatPage'
import Flow from '@flow/flow'
import common from '@data/common.json'

dotenv.config()
let flow: Flow

let homePage: IHomePage
let hubPage: IHubPage
let chatPage: IChatPage
const modelsHub = common.modelsHub
describe('Verify user can use a model from Hub', () => {
  before(async () => {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(driver)
      hubPage = new MacHubPage(driver)
      chatPage = new MacChatPage(driver)
    } else if (process.env.RUNNING_OS === 'win') {
      homePage = new WinHomePage(driver)
      hubPage = new WinHubPage(driver)
      chatPage = new WinChatPage(driver)
    } else if (process.env.RUNNING_OS === 'linux') {
      homePage = new LinuxHomePage(driver)
      hubPage = new LinuxHubPage(driver)
      chatPage = new LinuxChatPage(driver)
    }
    flow = new Flow(driver)
    await homePage.activateApp(process.env.BUNDLE_ID)
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
    await homePage.setWindowBounds()
  })

  it('should be able to search and use a model from hub', async () => {
    const model = modelsHub.qwen3
    await homePage.openHub()
    await hubPage.waitUntilElementIsVisible(hubPage.elements.searchModelsInput)
    await hubPage.searchModels(model)
    await hubPage.verifyModelIsShowing(model)
    await hubPage.selectModel(model)
    await chatPage.verifyChatInputVisible()
  })

  it('should be able to send a message using selected model', async () => {
    await chatPage.sendMessage('Hello')
    //await .takeScreenshot()
  })
})
