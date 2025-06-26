import { Browser } from 'webdriverio'
import { ISettingsPage, SettingsPageElements } from '@interface/iSettingsPage'
import BasePage from '@linux/basePage'
import { String } from 'typescript-string-operations'
import common from '@data/common.json'
const title = common.title
const toolApiKey = common.toolApiKey
export class SettingsPage extends BasePage implements ISettingsPage {
  elements: SettingsPageElements
  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      menuSub1: `//*[text()="{0}" or @name="{0}"]`,
      llamaTitle: `(//*[text()="Llama.cpp" or @name="Llama.cpp"])[2]`,
      model: `//*[text()="Models"]/parent::*[1]/following-sibling::*[text()="1"]`,
      modelItems: `(//a | //*[@role="link"])[1]//*[text()="{0}" or @name="{0}"]`,
      startBtn: `//*[@name="{0}" or text()="{0}"]/ancestor::*[2]/following-sibling::*[4]//*[self::button or @role="button"][1]`,
      deleteModelBtn: `//*[@name="{0}" or text()="{0}"]/ancestor::*[2]/following-sibling::*[3]`,
      settingsModelBtn: `//*[@name="{0}" or text()="{0}"]/ancestor::*[2]/following-sibling::*[2]`,
      editsModelBtn: `//*[@name="{0}" or text()="{0}"]/ancestor::*[2]/following-sibling::*[1]`,
      cancelPopupBtn: `//*[contains(@label, "Delete Model:") or contains(@name, "Delete Model:")]//button[1]`,
      deletePopupBtn: `//*[contains(@label, "Delete Model:") or contains(@name, "Delete Model:")]//button[2]`,
      closePopupBtn: `//*[contains(@label, "Delete Model:") or contains(@name, "Delete Model:")]//button[3]`,
      importBtn: `//*[text()="Models"]/parent::*[text()="1"]/following-sibling::*[self::button or @role="button"][1]`,
      toogle: `//*[@name="{0}" or text()="{0}"]/parent::*[1]/following-sibling::*[2]//*[self::input[@type="checkbox"] or @role="switch"][1]`,
      toogleItem: `//*[@name="{0}" or text()="{0}"]/following-sibling::*[self::input[@type="checkbox"] or @role="switch"][1]`,
      inputRightSetting: `//*[@name="{0}" or text()="{0}"]/parent::*[1]/following-sibling::*[self::input][1]`,
      closeModelSetting: `//*[@label="Model Settings - {0}" or @name="Model Settings - {0}"]//button[1]`,
      btnSetting: `//*[@name="{0}" or text()="{0}"]/parent::*[1]/following-sibling::*[1]//*[self::span or @role="text"][1]`,
      inputSetting: `//*[@name="{0}" or text()="{0}"]/parent::*[1]/following-sibling::*[contains(name(), 'input')][1]`,
      searchDropdownInput: `//div[contains(@class,"menu")]//input[1]`,
      itemDropdown: `//*[@role="menuitem" and (text()="{0}" or @name="{0}")]`,
      closeEditModel: `//*[@label="Edit Model: {0}" or @name="Edit Model: {0}"]//button[3]`,
    }
  }

  async selectSub1Menu(menu: string): Promise<void> {
    const locator = String.format(this.elements.menuSub1, menu)
    await this.clickElement(locator)
  }
  async isLlamaTitle() {
    return await this.elementShouldBeVisible(this.elements.llamaTitle)
  }

  async getModels(): Promise<any> {
    const arr = new Array()
    const models = this.elements.model
    const count = await this.count(models)
    for (let i = 1; i <= count; i++) {
      const locator = models + '[' + i + ']'
      const model = await this.getText(locator)
      arr.push(model)
    }
    return arr
  }

  async isModel(model: string): Promise<boolean> {
    const locator = String.format(this.elements.menuSub1, model)
    return await this.elementShouldBeVisible(locator)
  }

  async startOrStopModel(model: string): Promise<void> {
    const locator = String.format(this.elements.startBtn, model)
    await this.clickElement(locator)
    await this.waitForTimeout(5000)
  }

  async getTextStatus(model: string): Promise<any> {
    await this.waitForTimeout(5000)
    const locator = String.format(this.elements.startBtn, model)
    return await this.getText(locator)
  }

  async toggle(title: string, statusExpect: boolean): Promise<void> {
    let locator = String.format(this.elements.toogle, title)
    if (!(await this.elementShouldBeVisible(locator))) {
      locator = String.format(this.elements.toogleItem, title)
    }
    let status = (await this.getText(locator)) == '1' ? true : false
    if (status != statusExpect) {
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

  async tapButtonDeletePopup(nameButton: string) {
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
    const eyeLocator = locator + '/following-sibling::XCUIElementTypeButton[1]'
    const copyLocator = locator + '/following-sibling::XCUIElementTypeButton[2]'
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
    let locator = String.format(this.elements.itemDropdown, codeBlock)
    if (!(await this.isText(codeBlock))) {
      await this.enterText(this.elements.searchDropdownInput, codeBlock)
    }
    await this.clickElement(locator)
  }

  async closeSettingModel(model: string) {
    let locator = String.format(this.elements.closeModelSetting, model)
    await this.clickElement(locator)
  }
}
