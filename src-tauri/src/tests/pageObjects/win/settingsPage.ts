import { Browser } from 'webdriverio'
import { ISettingsPage, SettingsPageElements } from '@interface/iSettingsPage'
import BasePage from '@win/basePage'
import { String } from 'typescript-string-operations'
import common from '@data/common.json'

const title = common.title
const toolApiKey = common.toolApiKey

export class SettingsPage extends BasePage implements ISettingsPage {
  elements: SettingsPageElements

  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      menuSub1: `//*[@Name="{0}"]`,
      llamaTitle: `(//*[@Name="Llama.cpp"])[2]`,
      model: `//*[@Name="Models"]/following-sibling::Text[@ClassName="font-medium"]`,
      modelItems: `//Text[@Name="{0}"]`,
      startBtn: `//Text[@Name="{0}"]/following-sibling::Button[1]`,
      deleteModelBtn: `//Text[@Name="{0}"]/following-sibling::Group[3]/Image[1]`,
      settingsModelBtn: `//Text[@Name="{0}"]/following-sibling::Group[2]/Image[1]`,
      editsModelBtn: `//Text[@Name="{0}"]/following-sibling::Group[1]/Image[1]`,
      cancelPopupBtn: `//Button[@Name="Cancel"]`,
      deletePopupBtn: `//Button[@Name="Delete"]`,
      closePopupBtn: `//Button[@Name="Close"]`,
      importBtn: `//Button[@Name="Import"]`,
      toogle: `//*[@Name="{0}"]/following-sibling::Button[1]`,
      toogleItem: `//*[@Name="{0}"]/following-sibling::Button[1]`,
      inputRightSetting: `//*[@Name="{0}"]/following-sibling::Spinner[1]`,
      closeModelSetting: `//Button[@Name="Close"]`,
      btnSetting: `//*[@Name="{0}"]/following-sibling::Button[1]`,
      inputSetting: `//*[@Name="{0}"]/following-sibling::Edit[1]`,
      searchDropdownInput: `//Menu/Edit`,
      itemDropdown: `//Menu/[@ControlType="MenuItem" and @Name="{0}"]`,
      closeEditModel: `//Button[@Name="Close"]`,
    }
  }

  async selectSub1Menu(menu: string): Promise<void> {
    const locator = String.format(this.elements.menuSub1, menu)
    await this.clickElement(locator)
  }

  async isLlamaTitle(): Promise<boolean> {
    return await this.elementShouldBeVisible(this.elements.llamaTitle)
  }

  async getModels(): Promise<any> {
    await this.waitForTimeout(1000)
    const arr = new Array()
    const models = this.elements.model
    const count = await this.count(models)
    for (let i = 1; i <= count; i++) {
      const locator = '(' + models + ')' + `[${i}]`
      const model = await this.getText(locator)
      arr.push(model)
    }
    console.log(arr);
    
    return arr
  }

  async isModel(model: string): Promise<boolean> {
    const locator = String.format(this.elements.menuSub1, model)
    return await this.elementShouldBeVisible(locator)
  }

  async startOrStopModel(model: string): Promise<void> {
    const locator = String.format(this.elements.startBtn, model)
    await this.clickElement(locator)
    await this.waitForTimeout(10000)
  }

  async getTextStatus(model: string): Promise<any> {
    await this.waitForTimeout(10000)
    const locator = String.format(this.elements.startBtn, model)
    return await this.getText(locator)
  }

  async toggle(title: string, statusExpect: boolean): Promise<void> {
    let locator = String.format(this.elements.toogle, title)
    const toogleOnLocator = locator + "[@ToggleState='On']"
    const current = await this.elementShouldBeVisible(toogleOnLocator)
    console.log(current)
    if (current !== statusExpect) {
      await this.clickElement(locator)
      await this.waitForTimeout(3000)
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
    await this.clickElement(locator)
  }

  async tapButtonDeletePopup(nameButton: string): Promise<void> {
    switch (nameButton) {
      case 'Cancel':
        await this.clickElement(this.elements.cancelPopupBtn)
        break
      case 'Delete':
        await this.clickElement(this.elements.deletePopupBtn)
        break
      case 'Close':
        await this.clickElement(this.elements.closePopupBtn)
        break
    }
  }

  async enterInputSettingModel(name: string, value: string): Promise<void> {
    const locator = String.format(this.elements.inputRightSetting, name)
    await this.enterText(locator, value)
  }

  async tapBtnSetting(title: string): Promise<void> {
    const locator = String.format(this.elements.btnSetting, title)
    await this.clickElement(locator)
  }

  async enterSetting(title: string, text: string): Promise<void> {
    const locator = String.format(this.elements.inputSetting, title)
    await this.enterText(locator, text)
    await this.waitForTimeout(2000)
  }

  async getValueSetting(title: string): Promise<any> {
    const locator = String.format(this.elements.inputSetting, title)
    return await this.getText(locator)
  }

  async tapToolAPIKey(name: string): Promise<void> {
    const locator = String.format(this.elements.inputSetting, title.apiKey)
    const eyeLocator =
      locator + `/following-sibling::*[@Name="Show" and @ControlType="Button"]`
    const copyLocator =
      locator + `/following-sibling::*[@Name="Copy" and @ControlType="Button"]`
    switch (name) {
      case toolApiKey.eye:
        await this.clickElement(eyeLocator)
        break
      case toolApiKey.copy:
        await this.clickElement(copyLocator)
        break
    }
  }

  async selectDropdown(codeBlock: string): Promise<void> {
    const locator = String.format(this.elements.itemDropdown, codeBlock)
    if (!(await this.isText(codeBlock))) {
      await this.enterText(this.elements.searchDropdownInput, codeBlock)
    }
    await this.clickElement(locator)
  }

  async closeSettingModel(model: string): Promise<void> {
    const locator = String.format(this.elements.closeModelSetting, model)
    await this.clickElement(locator)
  }
}
