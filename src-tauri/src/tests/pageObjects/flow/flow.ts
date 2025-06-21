import * as dotenv from 'dotenv'
import { IHomePage } from '@interface/iHomePage'
import { IHubPage } from '@interface/iHubPage'
import { ISettingsPage } from '@interface/iSettingsPage'
import { IChatPage } from '@interface/iChatPage'
import { HomePage as MacHomePage } from '@mac/homePage'
import { HubPage as MacHubPage } from '@mac/hubPage'
import { ChatPage as MacChatPage } from '@mac/chatPage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
import common from '@data/common.json'
import { String } from 'typescript-string-operations'
dotenv.config()

let homePage: IHomePage
let hubPage: IHubPage
let chatPage: IChatPage
let settingsPage: ISettingsPage
const submenu1 = common.submenu1
let notify = common.notify
let modelsHub = common.modelsHub
let modelType = common.modelType
let models = common.models
let title = common.title
let ui = common.ui
let toolApiKey = common.toolApiKey

export default class Flow {
  public initializePages(driver: any): void {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(driver)
      hubPage = new MacHubPage(driver)
      chatPage = new MacChatPage(driver)
      settingsPage = new MacSettingsPage(driver)
    } else {
      throw new Error('Unsupported OS or missing page implementations.')
    }
  }

  public async checkAndDownloadModels(driver: any, models: any): Promise<void> {
    this.initializePages(driver)
    if (!(await settingsPage.isText(modelType.llama))) {
      await homePage.openSettings()
      await settingsPage.selectSub1Menu(submenu1.modelProviders)
    } else {
      await settingsPage.selectSub1Menu(modelType.llama)
    }
    const list = await settingsPage.getModels()
    const arr = new Array()
    for (let i = 0; i < models.length; i++) {
      const idx = list.indexOf(models[i])
      if (idx == -1) {
        arr.push(models[i])
      }
    }
    for (let i = 0; i < arr.length; i++) {
      await this.dowloadModels(driver, arr[i])
    }
  }

  public async dowloadModels(driver: any, model: string) {
    this.initializePages(driver)
    if (
      model == models.qwen3v0dot6b ||
      model == models.qwen3v1dot7b ||
      model == models.qwen3v4b
    ) {
      if (!(await hubPage.isText(model))) {
        await homePage.openHub()
        await hubPage.searchModels(modelsHub.qwen3)
        await hubPage.tapToggleModel(modelsHub.qwen3)
      }
      await hubPage.downloadModelVersion(model)
      const locator = String.format(
        hubPage.elementsCom.text,
        notify.title.downloadComplete
      )
      await hubPage.waitUntilElementIsVisible(locator, 900000)
      await hubPage.waitForTimeout(5000)
    }
  }

  async configAPIKey(driver: any, key: string) {
    this.initializePages(driver)
    if (!(await settingsPage.isText(modelType.openAI))) {
      await this.goToModelProviders(driver)
    }
    await settingsPage.selectSub1Menu(modelType.openAI)
    await settingsPage.tapToolAPIKey(toolApiKey.eye)
    const value = await settingsPage.getValueSetting(title.apiKey)
    if (value != key) {
      await settingsPage.enterSetting(title.apiKey, key)
    }
  }

  async goToModelProviders(driver: any) {
    this.initializePages(driver)
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
  }

  async getContentAndThought(driver: any, index: number = 1) {
    this.initializePages(driver)
    await chatPage.waitSendDone(120000)
    const content = await chatPage.getContentResp(index)
    let thought = new Array()
    if (await chatPage.isThought(index)) {
      await chatPage.tapThought(index)
      thought = await chatPage.getContentThought(index)
      await chatPage.tapThought(index)
    }
    return {
      content: content,
      thought: thought,
    }
  }

  async sentAndWait(driver: any, msg: string) {
    this.initializePages(driver)
    await chatPage.sendMessage(msg)
    await chatPage.waitSendDone(120000)
  }

  async createThead(driver: any, model: string, msg: string) {
    this.initializePages(driver)
    await homePage.openNewChat()
    await chatPage.selectModel(model)
    await this.sentAndWait(driver, msg)
    return await this.getContentAndThought(driver)
  }

  async showLoadingModelAndDisableInputSending(
    driver: any,
    model: string,
    msg: string
  ) {
    this.initializePages(driver)
    const loadingModel = ui.loadingModel
    await chatPage.selectModel(model)
    await chatPage.sendMessage(msg)
    await chatPage.waitText(loadingModel)
    expect(await chatPage.isText(loadingModel)).toBe(true)
    expect(await chatPage.getSendInputEnabled()).toBe('false')
    await chatPage.waitSendDone(120000)
  }

  async configCodeBlock(driver: any, codeBlock: string) {
    this.initializePages(driver)
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.appearance)
    if (!(await chatPage.isText(codeBlock))) {
      await settingsPage.tapBtnSetting(title.codeBlock)
      await settingsPage.selectDropdown(codeBlock)
    }
  }

  async getStatusModels(driver: any, models: any) {
    this.initializePages(driver)
    let object: any = {}
    for (let i = 0; i < models.length; i++) {
      const model = models[i]
      let status = await settingsPage.getTextStatus(model)
      object[model] = status
    }
    return object
  }

  async changeSettingModel(title: string, value: string) {
    await settingsPage.enterInputSettingModel(title, value)
    await chatPage.waitForTimeout(500)
    await chatPage.clickAtPoint(200, 200)
    await chatPage.waitForTimeout(2000)
  }
}
