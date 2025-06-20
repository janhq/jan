import { IBasePage } from '@interface/iBasePage'

export type SettingsPageElements = {
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
  inputRightSetting: string
  closeModelSetting: string
  btnSetting: string
  inputSetting: string
  searchDropdownInput: string
  itemDropdown: string
}

export interface ISettingsPage extends IBasePage {
  elements: SettingsPageElements
  selectSub1Menu(menu: string): Promise<void>
  isLlamaTitle(): Promise<boolean>
  getModels(): Promise<any>
  isModel(model: string): Promise<boolean>
  isNotify(title: string, detail: string): Promise<boolean>
  startOrStopModel(model: string): Promise<void>
  getTextStatus(model: string): Promise<any>
  toggle(title: string, statusExpect: boolean): Promise<void>
  tapBtnModel(model: string, name: string): Promise<void>
  tapButtonDeletePopup(nameBtn: string): Promise<void>
  enterInputSettingModel(name: string, value: string): Promise<void>
  tapBtnSetting(title: string): Promise<void>
  selectDropdown(codeBlock: string): Promise<void>
  enterSetting(title: string, text: string): Promise<void>
  getValueSetting(title: string): Promise<any>
  tapToolAPIKey(name: string): Promise<void>
  closeSettingModel(model: string): Promise<void>
}
