import { HomePage } from '../pom/homePage'
import { HubPage } from '../pom/hubPage'
import { ChatPage } from '../pom/chatPage'
import { SettingsPage } from '../pom/settingsPage'

import common from '../data/common.json'
import { String } from 'typescript-string-operations'

let homePage = new HomePage()
let hubPage = new HubPage()
let chatPage = new ChatPage()
let settingsPage = new SettingsPage()
const submenu1 = common.submenu1
let notify = common.notify
let modelsHub = common.modelsHub
let modelType = common.modelType
let models = common.models
let title = common.title
let ui = common.ui
let btn = common.btn
let toolApiKey = common.toolApiKey

export default class Flow {
  public async checkAndDownloadModels(models: any): Promise<void> {
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
      await hubPage.wait(5000)
    }
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

  async getContentAndThought(index: number = 1) {
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
    return await this.getContentAndThought()
  }

  async showLoadingModelAndDisableInputSending(model: string, msg: string) {
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

  async getStatusModels(driver: any, models: any) {
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
    await chatPage.wait(500)
    await chatPage.clickAtPoint(200, 200)
    await chatPage.wait(2000)
  }

  async updateVersion(driver: any) {
    if (!(await settingsPage.isText(btn.updateNow))) {
      await homePage.tapText(btn.updateNow)
      await homePage.wait(10000)
    }
  }
}
