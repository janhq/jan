import { Browser } from 'webdriverio'
import { IHubPage, HubPageElements } from '@interface/iHubPage'
import BasePage from '@linux/basePage'
import { String } from 'typescript-string-operations'
import common from '@data/common.json'
const btnModelHub = common.btnModelHub
const notify = common.notify
export class HubPage extends BasePage implements IHubPage {
  elements: HubPageElements

  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      searchModelsInput: `//input[@placeholder="Search for models on Hugging Face..."]`,
      modelName: `//*[@role="link" or self::a or self::button][@name="{0}" or text()="{0}"]`,
      btnModel: `(//*[@role="link" or self::a or self::button][@name="{0}" or text()="{0}"])/following-sibling::*[self::button or @role="button"][1]`,
      toggleModel: `(//*[@role="link" or self::a or self::button][@name="{0}" or text()="{0}"])/following-sibling::*[self::input[@type="checkbox"] or @role="switch"][1]`,
      downloadIcon: `//*[@name="{0}" or text()="{0}"]/following-sibling::*[2]`,
    }
  }

  async searchModels(modelName: string): Promise<void> {
    await this.waitUntilElementIsVisible(this.elements.searchModelsInput, 10000)
    await this.enterText(this.elements.searchModelsInput, modelName)
  }

  async verifyModelIsShowing(modelName: string): Promise<void> {
    const model = String.format(this.elements.modelName, modelName)
    await this.elementShouldBeVisible(model)
  }

  async downloadModel(modelName: string): Promise<void> {
    const locator = String.format(this.elements.btnModel, modelName)
    await this.clickElement(locator)
    const notifyLocator = String.format(
      this.elementsCom.text,
      notify.title.downloadComplete
    )
    await this.waitUntilElementIsVisible(notifyLocator, 900000)
    await this.waitForTimeout(5000)
  }

  async selectModel(modelName: string): Promise<void> {
    const nameBtn = await this.getTextBtn(modelName)
    if (nameBtn == btnModelHub.download) {
      await this.downloadModel(modelName)
    }
    const locator = String.format(this.elements.btnModel, modelName)
    await this.clickElement(locator)
  }

  async getTextBtn(modelName: string): Promise<any> {
    const locator = String.format(this.elements.btnModel, modelName)
    return await this.getText(locator)
  }

  async tapToggleModel(modelName: string) {
    const locator = String.format(this.elements.toggleModel, modelName)
    await this.clickElement(locator)
  }

  async downloadModelVersion(modelVersion: string) {
    const locator = String.format(this.elements.downloadIcon, modelVersion)
    await this.clickElement(locator)
  }
}
