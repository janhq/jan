import { IBasePage } from '@interface/iBasePage'

export type HubPageElements = {
  searchModelsInput: string
  modelName: string
  btnModel: string
  toggleModel: string
  downloadIcon: string
}

export interface IHubPage extends IBasePage {
  elements: HubPageElements
  searchModels(modelName: string): Promise<void>
  selectModel(modelName: string): Promise<void>
  downloadModel(modelName: string): Promise<void>
  verifyModelIsShowing(modelName: string): Promise<void>
  getTextBtn(modelName: string): Promise<void>
  tapToggleModel(modelName: string): Promise<void>
  downloadModelVersion(modelVersion: string): Promise<void>
}
