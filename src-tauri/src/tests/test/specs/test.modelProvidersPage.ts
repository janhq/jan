import * as dotenv from 'dotenv'
// interface
import { IHomePage } from '@interface/iHomePage'
import { ISettingsPage } from '@interface/iSettingsPage'
// mac
import { HomePage as MacHomePage } from '@mac/homePage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
// win
import { HomePage as WinHomePage } from '@win/homePage'
import { SettingsPage as WinSettingsPage } from '@win/settingsPage'
// linux
import { HomePage as LinuxHomePage } from '@linux/homePage'
import { SettingsPage as LinuxSettingsPage } from '@linux/settingsPage'

import Flow from '@flow/flow'
import Utilities from '@core_lib/utilities'
const utilities = new Utilities()
import common from '@data/common.json'
import { String } from 'typescript-string-operations'
const flow = new Flow()
dotenv.config()

let homePage: IHomePage
let settingsPage: ISettingsPage
const submenu1 = common.submenu1
const models = common.models
const title = common.title
const notify = common.notify
const btnModel = common.btnModel
const imports = common.import
const address = common.adress
const btn = common.btn
const ui = common.ui

describe('Model providers', () => {
  before(async () => {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(driver)
      settingsPage = new MacSettingsPage(driver)
    } else if (process.env.RUNNING_OS === 'win') {
      homePage = new WinHomePage(driver)
      settingsPage = new WinSettingsPage(driver)
    } else if (process.env.RUNNING_OS === 'linux') {
      homePage = new LinuxHomePage(driver)
      settingsPage = new LinuxSettingsPage(driver)
    }
    await homePage.activateApp(process.env.BUNDLE_ID)
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
    await homePage.setWindowBounds()
    await flow.checkAndDownloadModels(driver, [
      models.qwen3v0dot6b,
      models.qwen3v1dot7b,
    ])
  })

  it('Models downloaded from the Hub should appear in the list of Models.', async () => {
    await homePage.openNewChat()
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
    const isLlama = await settingsPage.isLlamaTitle()
    expect(isLlama).toBe(true)
  })

  it('Successfully import model from GGUF file', async () => {
    await settingsPage.clickElement(settingsPage.elements.importBtn)
    const url = imports.downloadQwen3
    await utilities.downloadFile(url, address.modelsFolder)
    const uploaded = await settingsPage.uploadFile(
      utilities.fromRoot(imports.qwen3)
    )
    const importModel =
      process.env.RUNNING_OS == 'win'
        ? notify.title.import
        : notify.title.importModel
    expect(uploaded).toBe(true)
    const isNotify = await settingsPage.isNotify(
      importModel,
      String.format(notify.content.importModelSuccess, 'llama.cpp')
    )
    expect(isNotify).toBe(true)
  })

  it('Only one model starts at a time when Auto-Unload Old Models is enabled.', async () => {
    const model1 = models.qwen3v1dot7b
    const model2 = models.qwen3v0dot6b
    await settingsPage.toggle(title.autoUnloadOldModels, true)
    await settingsPage.startOrStopModel(model1)
    let model1Status = await settingsPage.getTextStatus(model1)
    expect(model1Status).toBe(btnModel.stop)
    await settingsPage.startOrStopModel(model2)
    model1Status = await settingsPage.getTextStatus(model1)
    let model2Status = await settingsPage.getTextStatus(model2)
    expect(model1Status).toBe(btnModel.start)
    expect(model2Status).toBe(btnModel.stop)
  })

  it('Multiple models can run simultaneously when Auto-Unload Old Models is disabled.', async () => {
    const model1 = models.qwen3v0dot6b
    const model2 = models.qwen3v1dot7b
    await settingsPage.startOrStopModel(model1)
    await settingsPage.toggle(title.autoUnloadOldModels, false)
    await settingsPage.startOrStopModel(model2)
    await settingsPage.startOrStopModel(model1)
    let llama3Status = await settingsPage.getTextStatus(model2)
    let qwen3Status = await settingsPage.getTextStatus(model1)
    expect(llama3Status).toBe(btnModel.stop)
    expect(qwen3Status).toBe(btnModel.stop)
  })

  it('Delete popup shows model name and removes it after confirmation.', async () => {
    const model = models.qwen3Embedding
    await settingsPage.tapBtnModel(model, btnModel.delete)
    expect(await settingsPage.isText(ui.deleteModel)).toBe(true)
    expect(await settingsPage.isText(model)).toBe(true)
    await settingsPage.tapButtonDeletePopup(btn.delete)
    const isNotify = await settingsPage.isNotify(
      notify.title.deleteModel,
      String.format(notify.content.deleteModelSuccess, model)
    )
    expect(isNotify).toBe(true)
  })

  it('Test response creativity using Temperature, Top K, Top P, and Min P.', async () => {
    const msg = 'Hello'
    const model = models.qwen3v4b
    await settingsPage.tapBtnModel(model, btnModel.settings)
    const settings = title.modelSettings
    await settingsPage.enterInputSettingModel(settings.temperature, '100')
    await settingsPage.enterInputSettingModel(settings.topK, '0.7')
    await settingsPage.enterInputSettingModel(settings.topP, '0.8')
    await settingsPage.closeSettingModel(model)
    const response = await flow.createThead(driver, model, msg)
    expect(response.content.length).toBeGreaterThan(0)
  })

  it('Test answer coherence with Temperature, Top K, and Top P.', async () => {
    const msg = 'Hello'
    const model = models.qwen3v4b
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
    await settingsPage.tapBtnModel(model, btnModel.settings)
    const settings = title.modelSettings
    await settingsPage.enterInputSettingModel(settings.temperature, '100')
    await settingsPage.enterInputSettingModel(settings.topK, '40')
    await settingsPage.closeSettingModel(model)
    const response = await flow.createThead(driver, model, msg)
    expect(response.content.length).toBeGreaterThan(0)
  })

  it('Test repetition control using Repeat Last N and Repeat Penalty.', async () => {
    const msg = 'Hello'
    const model = models.qwen3v4b
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
    await settingsPage.tapBtnModel(model, btnModel.settings)
    const settings = title.modelSettings
    await settingsPage.enterInputSettingModel(settings.repeatLastN, '')
    await settingsPage.enterInputSettingModel(settings.repeatPenalty, '')
    await settingsPage.clickAtPoint(200, 200)
    const response = await flow.createThead(driver, model, msg)
    expect(response.content.length).toBeGreaterThan(0)
  })

  it('Tool icon appears when a tool is enabled for a model.', async () => {
    const model = models.qwen3v4b
    await homePage.openNewChat()
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
    await settingsPage.tapBtnModel(model, btnModel.edit)
    await settingsPage.toggle(title.editModel.tools, true)
    await settingsPage.clickAtPoint(100, 100)
    await settingsPage.waitForTimeout(1000)
  })

  it('Show error when using an invalid API key with a remote model.', async () => {
    const key = 'invalid'
    const model = models.gptv4dot5Preview
    const msg = 'Hello'
    await flow.configAPIKey(driver, key)
    await flow.createThead(driver, model, msg)
    expect(
      await settingsPage.isNotify(notify.content.incorrectAPIKeyProvided)
    ).toBe(true)
  })
})
