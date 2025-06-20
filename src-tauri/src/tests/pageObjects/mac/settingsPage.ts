import { Browser } from 'webdriverio'
import { ISettingsPage, SettingsPageElements } from '../interface/iSettingsPage'
import BasePage from './basePage'
import { String } from 'typescript-string-operations'
export class SettingsPage extends BasePage implements ISettingsPage {
  elements: SettingsPageElements
  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      menuSub1: `//XCUIElementTypeStaticText[@value="{0}"]`,
      llamaTitle: `(//XCUIElementTypeStaticText[@value="Llama.cpp"])[2]`,
      model: `//XCUIElementTypeStaticText[@value="Models"]/parent::*[1]/following-sibling::XCUIElementTypeStaticText[@value="1"]`,
      modelItems: `//XCUIElementTypeLink[1]/XCUIElementTypeStaticText[@value="{0}"]`,
      startBtn: `//*[@value="{0}"]/parent::*[1]/parent::*[1]/following-sibling::XCUIElementTypeGroup[4]/XCUIElementTypeButton[1]`,
      deleteModelBtn: `//*[@value="{0}"]/parent::*[1]/parent::*[1]/following-sibling::XCUIElementTypeGroup[3]`,
      settingsModelBtn: `//*[@value="{0}"]/parent::*[1]/parent::*[1]/following-sibling::XCUIElementTypeGroup[2]`,
      editsModelBtn: `//*[@value="{0}"]/parent::*[1]/parent::*[1]/following-sibling::XCUIElementTypeGroup[1]`,
      cancelPopupBtn: `//*[contains(@label, "Delete Model:")]/XCUIElementTypeButton[1]`,
      deletePopupBtn: `//*[contains(@label, "Delete Model:")]/XCUIElementTypeButton[2]`,
      closePopupBtn: `//*[contains(@label, "Delete Model:")]/XCUIElementTypeButton[3]`,
      importBtn: `//XCUIElementTypeStaticText[@value="Models"]/parent::XCUIElementTypeStaticText[@value="1"]/following-sibling::XCUIElementTypeButton[1]`,
      toogle: `//*[@value="{0}"]/parent::*[1]/following-sibling::XCUIElementTypeGroup[2]/XCUIElementTypeSwitch[1]`,
      inputRightSetting: `//*[@value="{0}"]/parent::*[1]/following-sibling::XCUIElementTypeTextField[1]`,
      btnSetting: `//*[@value="{0}"]/parent::*[1]/following-sibling::XCUIElementTypeGroup[1]/XCUIElementTypeStaticText[1]`,
      inputSetting: `//*[@value="{0}"]/parent::*[1]/following-sibling::XCUIElementTypeSecureTextField[1]`,
      searchDropdownInput: `//XCUIElementTypeMenu/XCUIElementTypeTextField[1]`,
      itemDropdown: `//XCUIElementTypeMenuItem[@title='{0}']`,
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
    const locator = String.format(this.elements.toogle, title)
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

  async selectDropdown(codeBlock: string): Promise<void> {
    let locator = String.format(this.elements.itemDropdown, codeBlock)
    if (!(await this.isText(codeBlock))) {
      await this.enterText(this.elements.searchDropdownInput, codeBlock)
    }
    await this.clickElement(locator)
  }
}
