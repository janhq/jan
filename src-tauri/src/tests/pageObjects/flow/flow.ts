import * as dotenv from 'dotenv'
import { IHomePage } from '../interface/iHomePage'
import { IHubPage } from '../interface/iHubPage'
import { ISettingsPage } from '@interface/iSettingsPage'
import { IChatPage } from '../interface/iChatPage'
import { HomePage as MacHomePage } from '../mac/homePage'
import { HubPage as MacHubPage } from '../mac/hubPage'
import { ChatPage as MacChatPage } from '../mac/chatPage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
import common from '../../data/common.json'
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
}
