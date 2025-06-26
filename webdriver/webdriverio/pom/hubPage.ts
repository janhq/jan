import BasePage from './basePage'
import { String } from 'typescript-string-operations'
import common from '../data/common.json'

const btnModelHub = common.btnModelHub
export type HubElements = {
  searchModelsInput: string
  modelName: string
  btnModel: string
  toggleModel: string
  downloadIcon: string
}
export class HubPage extends BasePage {
  elements: HubElements
  constructor() {
    super()
    this.elements = {
      searchModelsInput: `//input[@placeholder="Search for models on Hugging Face..."]`,
      modelName: `//h1[text()="{0}"]`,
      btnModel: `//h1[text()="{0}"]/parent::*[1]/following-sibling::div[1]/div[1]/button[1]`,
      toggleModel: `//h1[text()="{0}"]/parent::*[1]/parent::*[1]/following-sibling::div[1]//button[@role="switch"]`,
      downloadIcon: `//h1[text()="{0}"]/parent::*[1]/following-sibling::div[1]/div[1]/div[1]`,
    }
  }

  async searchModels(modelName: string): Promise<void> {
    await this.waitUntilElementIsVisible(this.elements.searchModelsInput, 10000)
    await this.enterText(this.elements.searchModelsInput, modelName)
  }

  async verifyModelIsShowing(modelName: string): Promise<void> {
    const model = String.format(this.elements.modelName, modelName)
    await this.isDisplayed(model)
  }

  async downloadModel(modelName: string): Promise<void> {
    const locator = String.format(this.elements.btnModel, modelName)
    await this.click(locator)
    await this.wait(20000) // optionally wait for download
  }

  async selectModel(modelName: string): Promise<void> {
    const nameBtn = await this.getTextBtn(modelName)
    if (nameBtn === btnModelHub.download) {
      await this.downloadModel(modelName)
    }
    const locator = String.format(this.elements.btnModel, modelName)
    await this.click(locator)
  }

  async getTextBtn(modelName: string): Promise<any> {
    const locator = String.format(this.elements.btnModel, modelName)
    return await this.getText(locator)
  }

  async tapToggleModel(modelName: string): Promise<void> {
    const locator = String.format(this.elements.toggleModel, modelName)
    await this.click(locator)
  }

  async downloadModelVersion(modelVersion: string): Promise<void> {
    const locator = String.format(this.elements.downloadIcon, modelVersion)
    await this.click(locator)
  }
}
