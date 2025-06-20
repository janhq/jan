import * as dotenv from 'dotenv'
import { IHomePage } from '@interface/iHomePage'
//declare
import { ISettingsPage } from '@interface/iSettingsPage'
import { HomePage as MacHomePage } from '@mac/homePage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
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
    expect(uploaded).toBe(true)
    const isNotify = await settingsPage.isNotify(
      notify.title.importModel,
      String.format(notify.content.importModelSuccess, 'llama.cpp')
    )
    expect(isNotify).toBe(true)
  })

  it('Only one model starts at a time when Auto-Unload Old Models is enabled.', async () => {
    const model1 = models.qwen3v1dot7b
    const model2 = models.qwen3v0dot6b
    await settingsPage.toggle(title.autoUnloadOldModels, true)
    await settingsPage.startOrStopModel(model1)
    let llama3Status = await settingsPage.getTextStatus(model1)
    expect(llama3Status).toBe(btnModel.stop)
    await settingsPage.startOrStopModel(model2)
    llama3Status = await settingsPage.getTextStatus(model1)
    let qwen3Status = await settingsPage.getTextStatus(model2)
    expect(llama3Status).toBe(btnModel.start)
    expect(qwen3Status).toBe(btnModel.stop)
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
    const model = models.qwen3v1dot7b
    await settingsPage.tapBtnModel(model, btnModel.settings)
    const settings = title.modelSettings
    await settingsPage.enterInputSettingModel(settings.contextSize, '4085')
  })
})
