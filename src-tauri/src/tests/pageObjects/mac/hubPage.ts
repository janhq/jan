import { Browser } from "webdriverio";
import { IHubPage, HubPageElements } from "../interface/iHubPage";
import BasePage from "./basePage";
import { String } from "typescript-string-operations";
import common from "@data/common.json";
const btnModelHub = common.btnModelHub;
export class HubPage extends BasePage implements IHubPage {
  elements: HubPageElements;

  constructor(driver: Browser) {
    super(driver);
    this.elements = {
      searchModelsInput: `//XCUIElementTypeTextField[@placeholderValue="Search for models on Hugging Face..."]`,
      modelName: `//XCUIElementTypeLink[@title="{0}"]`,
      btnModel: `//XCUIElementTypeLink[@title="{0}"]/following-sibling::XCUIElementTypeButton[1]`,
    };
  }

  async searchModels(modelName: string): Promise<void> {
    await this.waitUntilElementIsVisible(
      this.elements.searchModelsInput,
      10000
    );
    await this.enterText(this.elements.searchModelsInput, modelName);
  }

  async verifyModelIsShowing(modelName: string): Promise<void> {
    const model = String.format(this.elements.modelName, modelName);
    await this.elementShouldBeVisible(model);
  }

  async downloadModel(modelName: string): Promise<void> {
    const locator = String.format(this.elements.btnModel, modelName);
    await this.clickElement(locator);
    // wait for the download to finish
    await this.waitForTimeout(20000);
  }

  async selectModel(modelName: string): Promise<void> {
    const nameBtn = await this.getTextBtn(modelName);
    if (nameBtn == btnModelHub.download) {
      await this.downloadModel(modelName);
    }
    const locator = String.format(this.elements.btnModel, modelName);
    await this.clickElement(locator);
  }

  async getTextBtn(modelName: string): Promise<any> {
    const locator = String.format(this.elements.btnModel, modelName);
    return await this.getText(locator);
  }
}
