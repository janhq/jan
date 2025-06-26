import BasePage from './basePage'
import { String } from 'typescript-string-operations'
import common from '../data/common.json'

const title = common.title
const toolApiKey = common.toolApiKey
export type SettingsElements = {
  menuSub1: string
  llamaTitle: string
  model: string
  modelItems: string
  startBtn: string
  deleteModelBtn: string
  settingsModelBtn: string
  editsModelBtn: string
  cancelPopupBtn: string
  deletePopupBtn: string
  closePopupBtn: string
  importBtn: string
  toogle: string
  toogleItem: string
  inputRightSetting: string
  closeModelSetting: string
  btnSetting: string
  inputSetting: string
  searchDropdownInput: string
  itemDropdown: string
  closeEditModel: string
}
export class SettingsPage extends BasePage {
  elements: SettingsElements
  constructor() {
    super()
    this.elements = {
      menuSub1: `//*[text()="{0}"]`,
      llamaTitle: `(//*[text()="Llama.cpp"])[2]`,
      model: `//*[text()="Models"]/parent::*[1]/following-sibling::div`,
      modelItems: `//*[text()="{0}"]`,
      startBtn: `//*[text()="{0}"]/parent::*[1]/parent::*[1]/parent::*[1]/following-sibling::div[1]/div[1]/div[4]/button[1]`,
      deleteModelBtn: `//*[text()="{0}"]/parent::*[1]/parent::*[1]/parent::*[1]/following-sibling::div[1]/div[1]/div[3]`,
      settingsModelBtn: `*[text()="{0}"]/parent::*[1]/parent::*[1]/parent::*[1]/following-sibling::div[1]/div[1]/div[2]`,
      editsModelBtn: `[text()="{0}"]/parent::*[1]/parent::*[1]/parent::*[1]/following-sibling::div[1]/div[1]/div[1]`,
      cancelPopupBtn: `//button[text()="Cancel"]`,
      deletePopupBtn: `//button[text()="Delete"]`,
      closePopupBtn: `//button[text()="Close"]`,
      importBtn: `//button[text()="Import"]`,
      toogle: `//h1[text()="{0}"]/parent::*[1]/following-sibling::div//button[1]`,
      toogleItem: `//span[text()="{0}"]/parent::*[1]/following-sibling::button[1]`,
      inputRightSetting: `//h3[text()="{0}"]/parent::*[1]/following-sibling::div[1]/input[1]`,
      closeModelSetting: `//button[text()="Close"]`,
      btnSetting: `//h1[text()="{0}"]/parent::*[1]/following-sibling::div[1]/button[1]`,
      inputSetting: `//h1[text()="{0}"]/parent::*[1]/following-sibling::div[1]//input[1]`,
      searchDropdownInput: `//input[@placeholder='Search styles...']`,
      itemDropdown: `//*[text()='{0}']`,
      closeEditModel: `//button/span[text()="Close"]`,
    }
  }

  async selectSub1Menu(menu: string): Promise<void> {
    const locator = String.format(this.elements.menuSub1, menu)
    await this.click(locator)
  }

  async isLlamaTitle(): Promise<boolean> {
    return await this.isDisplayed(this.elements.llamaTitle)
  }

  async getModels(): Promise<any> {
    await this.wait(1000)
    const arr = new Array()
    const models = this.elements.model
    const count = await this.count(models)
    for (let i = 1; i <= count; i++) {
      const locator = '(' + models + ')' + `[${i}]`
      const model = await this.getText(locator)
      arr.push(model)
    }
    console.log(arr)

    return arr
  }

  async isModel(model: string): Promise<boolean> {
    const locator = String.format(this.elements.menuSub1, model)
    return await this.isDisplayed(locator)
  }

  async startOrStopModel(model: string): Promise<void> {
    const locator = String.format(this.elements.startBtn, model)
    await this.click(locator)
    await this.wait(10000)
  }

  async getTextStatus(model: string): Promise<any> {
    await this.wait(10000)
    const locator = String.format(this.elements.startBtn, model)
    return await this.getText(locator)
  }

  async toggle(title: string, statusExpect: boolean): Promise<void> {
    let locator = String.format(this.elements.toogle, title)
    const toogleOnLocator = locator + "[@ToggleState='On']"
    const current = await this.isDisplayed(toogleOnLocator)
    console.log(current)
    if (current !== statusExpect) {
      await this.click(locator)
      await this.wait(3000)
    }
  }

  async tapBtnModel(model: string, nameButton: string): Promise<void> {
    let locator = ''
    switch (nameButton) {
      case 'Start':
        locator = String.format(this.elements.startBtn, model)
        break
      case 'Delete':
        locator = String.format(this.elements.deleteModelBtn, model)
        break
      case 'Settings':
        locator = String.format(this.elements.settingsModelBtn, model)
        break
      case 'Edit':
        locator = String.format(this.elements.editsModelBtn, model)
        break
    }
    await this.click(locator)
  }

  async tapButtonDeletePopup(nameButton: string): Promise<void> {
    switch (nameButton) {
      case 'Cancel':
        await this.click(this.elements.cancelPopupBtn)
        break
      case 'Delete':
        await this.click(this.elements.deletePopupBtn)
        break
      case 'Close':
        await this.click(this.elements.closePopupBtn)
        break
    }
  }

  async enterInputSettingModel(name: string, value: string): Promise<void> {
    const locator = String.format(this.elements.inputRightSetting, name)
    await this.enterText(locator, value)
  }

  async tapBtnSetting(title: string): Promise<void> {
    const locator = String.format(this.elements.btnSetting, title)
    await this.click(locator)
  }

  async enterSetting(title: string, text: string): Promise<void> {
    const locator = String.format(this.elements.inputSetting, title)
    await this.enterText(locator, text)
    await this.wait(2000)
  }

  async getValueSetting(title: string): Promise<any> {
    const locator = String.format(this.elements.inputSetting, title)
    return await this.getText(locator)
  }

  async tapToolAPIKey(name: string): Promise<void> {
    const locator = String.format(this.elements.inputSetting, title.apiKey)
    const eyeLocator =
      locator + `/following-sibling::*[text()="Show" and @ControlType="Button"]`
    const copyLocator =
      locator + `/following-sibling::*[text()="Copy" and @ControlType="Button"]`
    switch (name) {
      case toolApiKey.eye:
        await this.click(eyeLocator)
        break
      case toolApiKey.copy:
        await this.click(copyLocator)
        break
    }
  }

  async selectDropdown(codeBlock: string): Promise<void> {
    const locator = String.format(this.elements.itemDropdown, codeBlock)
    if (!(await this.isText(codeBlock))) {
      await this.enterText(this.elements.searchDropdownInput, codeBlock)
    }
    await this.click(locator)
  }

  async closeSettingModel(model: string): Promise<void> {
    const locator = String.format(this.elements.closeModelSetting, model)
    await this.click(locator)
  }
}
