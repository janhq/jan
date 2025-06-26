import * as dotenv from 'dotenv'
import { Browser } from 'webdriverio'
// interface
import { IHomePage } from '@interface/iHomePage'
import { IHubPage } from '@interface/iHubPage'
import { ISettingsPage } from '@interface/iSettingsPage'
import { IChatPage } from '@interface/iChatPage'
// mac
import { HomePage as MacHomePage } from '@mac/homePage'
import { HubPage as MacHubPage } from '@mac/hubPage'
import { ChatPage as MacChatPage } from '@mac/chatPage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
// win
import { HomePage as WinHomePage } from '@win/homePage'
import { HubPage as WinHubPage } from '@win/hubPage'
import { ChatPage as WinChatPage } from '@win/chatPage'
import { SettingsPage as WinSettingsPage } from '@win/settingsPage'
// linux
import { HomePage as LinuxHomePage } from '@linux/homePage'
import { HubPage as LinuxHubPage } from '@linux/hubPage'
import { ChatPage as LinuxChatPage } from '@linux/chatPage'
import { SettingsPage as LinuxSettingsPage } from '@linux/settingsPage'

import Utilities from '@core_lib/utilities'
const utilities = new Utilities()
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
let btn = common.btn
let toolApiKey = common.toolApiKey
let imports = common.import
let address = common.address

export default class Flow {
  protected driver: Browser
  constructor(driver: Browser) {
    this.driver = driver
    this.initializePages()
  }

  public initializePages(): void {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(this.driver)
      hubPage = new MacHubPage(this.driver)
      chatPage = new MacChatPage(this.driver)
      settingsPage = new MacSettingsPage(this.driver)
    } else if (process.env.RUNNING_OS === 'win') {
      homePage = new WinHomePage(this.driver)
      hubPage = new WinHubPage(this.driver)
      chatPage = new WinChatPage(this.driver)
      settingsPage = new WinSettingsPage(this.driver)
    } else if (process.env.RUNNING_OS === 'linux') {
      homePage = new LinuxHomePage(this.driver)
      hubPage = new LinuxHubPage(this.driver)
      chatPage = new LinuxChatPage(this.driver)
      settingsPage = new LinuxSettingsPage(this.driver)
    } else {
      throw new Error('Unsupported OS or missing page implementations.')
    }
  }

  public async checkDownloadModels(models: any): Promise<void> {
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
      await this.dowloadModels(arr[i])
    }
  }

  public async dowloadModels(model: string) {
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

  async checkImportModels(models: any) {
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
    const list = await settingsPage.getModels()
    console.log(list)
    console.log(models)

    const arr = new Array()
    for (let i = 0; i < models.length; i++) {
      const idx = list.indexOf(models[i])
      if (idx == -1) {
        arr.push(models[i])
      }
    }
    console.log(arr)

    for (let i = 0; i < arr.length; i++) {
      await this.importModel(arr[i])
    }
  }

  async importModel(model: string) {
    let url = ''
    let urlFile = ''
    switch (model) {
      case models.qwen2:
        url = imports.downloadQwen2
        urlFile = imports.qwen2
        break

      case models.qwen2dot5:
        url = imports.downloadQwen2dot5
        urlFile = imports.qwen2dot5
        break

      case models.qwen3Embedding:
        url = imports.downloadQwen3
        urlFile = imports.qwen3
        break
    }
    await settingsPage.clickElement(settingsPage.elements.importBtn)
    await utilities.downloadFile(url, address.modelsFolder)
    return await settingsPage.uploadFile(utilities.fromRoot(urlFile))
  }

  async configAPIKey(key: string) {
    if (!(await settingsPage.isText(modelType.openAI))) {
      await this.goToModelProviders()
    }
    await settingsPage.selectSub1Menu(modelType.openAI)
    await settingsPage.tapToolAPIKey(toolApiKey.eye)
    const value = await settingsPage.getValueSetting(title.apiKey)
    if (value != key) {
      await settingsPage.enterSetting(title.apiKey, key)
    }
  }

  async goToModelProviders() {
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
  }

  async getResponse(index: number = 1) {
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

  async sentAndWait(msg: string) {
    await chatPage.sendMessage(msg)
    await chatPage.waitSendDone(120000)
  }

  async createThead(model: string, msg: string) {
    await homePage.openNewChat()
    await chatPage.selectModel(model)
    await this.sentAndWait(msg)
    return await this.getResponse()
  }

  async waitLoadingModel(model: string, msg: string) {
    const loadingModel = ui.loadingModel
    await chatPage.selectModel(model)
    await chatPage.sendMessage(msg)
    await chatPage.waitText(loadingModel)
    expect(await chatPage.isText(loadingModel)).toBe(true)
    expect(await chatPage.getSendInputEnabled()).toBe('false')
    await chatPage.waitSendDone(120000)
  }

  async configCodeBlock(codeBlock: string) {
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.appearance)
    if (!(await chatPage.isText(codeBlock))) {
      await settingsPage.tapBtnSetting(title.codeBlock)
      await settingsPage.selectDropdown(codeBlock)
    }
  }

  async getStatusModels(models: any) {
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

  async updateVersion() {
    if (!(await settingsPage.isText(btn.updateNow))) {
      await homePage.tapText(btn.updateNow)
      await homePage.wait(10000)
    }
  }
}
