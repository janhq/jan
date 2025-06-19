import * as dotenv from 'dotenv'
import { IHomePage } from '@interface/iHomePage'
//declare
import { ISettingsPage } from '@interface/iSettingsPage'
import { HomePage as MacHomePage } from '@mac/homePage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
import common from '@data/common.json'
dotenv.config()

let homePage: IHomePage
let settingsPage: ISettingsPage
const submenu1 = common.submenu1
const models = common.models
const title = common.title
const btnModel = common.btnModel

describe('Model providers', () => {
  beforeEach(async () => {
    if (process.env.RUNNING_OS === 'macOS') {
      homePage = new MacHomePage(driver)
      settingsPage = new MacSettingsPage(driver)
    }
    await homePage.activateApp(process.env.BUNDLE_ID)
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
    await homePage.setWindowBounds()
  })

  it('Models downloaded from the Hub should appear in the list of Models.', async () => {
    await homePage.openSettings()
    await settingsPage.selectSub1Menu(submenu1.modelProviders)
    const isLlama = await settingsPage.isLlamaTitle()
    expect(isLlama).toBe(true)
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
})
