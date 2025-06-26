import { Browser } from 'webdriverio'
import { IChatPage as IChatPage } from '@interface/iChatPage'
import { ChatPageElements } from '@interface/iChatPage'
import BasePage from '@linux/basePage'
import { String } from 'typescript-string-operations'
import common from '@data/common.json'
const toolResp = common.toolResp
const toolSend = common.toolSend
const parts = common.partThread
const recentsMenu = common.recentsMenu
const favoritesMenu = common.favoritesMenu
const btn = common.btn
export class ChatPage extends BasePage implements IChatPage {
  elements: ChatPageElements
  constructor(driver: Browser) {
    super(driver)
    this.elements = {
      chatInput: `//textarea`,
      sendButton: `//textarea/parent::*[1]/following-sibling::*[self::button or @role="button"][1]`,
      modelBtn: `//textarea/parent::*[1]/following-sibling::*[contains(@class,"popup") or @role="combobox"][1]`,
      modelSettingBtn: `//textarea/parent::*[1]/following-sibling::*[contains(@class,"popup") or @role="combobox"][1]/following-sibling::*[1]`,
      searchModelInput: `//input[@placeholder='Search models...']`,
      modelItem: `//input[@placeholder='Search models...']/parent::*[1]/following-sibling::*[text()="{0}" or @name="{0}"][1]`,
      tableRes: `//table`,
      rowTableRes: `/tr`,
      colTableRes: `/td`,
      cellTableRes: `/td`,
      textCellTableRes: `/td//span | /td//div`,
      janName: `//*[text()="Jan" or @name="Jan"]`,
      thoughtBtn: `//button[text()='Thought' or @name='Thought']`,
      contentThought: `/following-sibling::*[1]//*[self::span or self::div or @role="text"]`,
      contentRoot: `/following-sibling::*[1]`,
      content2Root: `/following-sibling::*`,
      contentParts: `//*`,
      contentText: `//*[self::span or self::p or @role="text"]`,
      messageSend: `//*[text()="{0}" or @name="{0}"]`,
      editSendInput: `//*[@label="Edit Message" or @name="Edit Message"]//textarea[1]`,
      closeEditSendBtn: `//*[@label="Edit Message" or @name="Edit Message"]//button[3]`,
      cancelBtn: `//button[text()='Cancel' or @name='Cancel']`,
      saveBtn: `//button[text()='Save' or @name='Save']`,
      contentMetaData: `//*[@label="Message Metadata" or @name="Message Metadata"]//textarea[1]`,
      closeMetaDataBtn: `//*[@label="Edit Message" or @name="Edit Message"]//button[2]`,
      closeBtn: `//button[text()='Close' or @name='Close']`,
      searchHistoryInput: `//div[contains(@class,"group")]//input[1]`,
      threeDotsParts: `//*[text()="{0}" or @name="{0}"]/following-sibling::*[contains(@class,"popup") or @role="menu"][1]`,
      history: `//*[text()="{0}" or @name="{0}"]/following-sibling::*[self::button or @role="button"]`,
      closeDeleteAllBtn: `//*[@label="Delete All Threads" or @name="Delete All Threads"]//button[3]`,
      deleteBtn: `//button[text()='Delete' or @name='Delete']`,
      closeDeleteThreadBtn: `//*[@label="Delete Thread" or @name="Delete Thread"]//button[3]`,
      renameHistoryInput: `//*[text()="Thread Title" or @name="Thread Title"]/parent::*[1]/following-sibling::*[self::input][1]`,
      closeRenameHistoryBtn: `//*[text()="Thread Title" or @name="Thread Title"]/parent::*[1]/following-sibling::*[self::button][3]`,
      renameBtn: `//button[text()='Rename' or @name='Rename']`,
    }
  }

  async sendMessage(message: string): Promise<void> {
    await this.waitForTimeout(1000)
    if ((await this.getText(this.elements.chatInput)) != '') {
      await this.enterText(this.elements.chatInput, '')
    }
    await this.enterText(this.elements.chatInput, message)
    await this.clickElement(this.elements.sendButton)
  }

  async verifyChatInputVisible(): Promise<void> {
    const result = await this.elementShouldBeVisible(this.elements.chatInput)
    if (!result) {
      throw new Error('Chat input is not visible')
    }
  }

  async searchAndSelectModel(model: string) {
    await this.enterText(this.elements.searchModelInput, model)
    const fristModel = model.substring(0, 1)
    const locator = String.format(this.elements.modelItem, fristModel)
    await this.clickElement(locator)
  }
  async selectModel(model: string): Promise<void> {
    if (!(await this.isTextContains(model))) {
      await this.clickElement(this.elements.modelBtn)
      if (await this.isText(model)) {
        const locator = String.format(this.elements.modelItem, model)
        await this.clickElement(locator)
        if (await this.elementShouldBeVisible(this.elements.searchModelInput)) {
          await this.searchAndSelectModel(model)
        }
      } else {
        await this.searchAndSelectModel(model)
      }
    }
  }

  async tapModelSetting(): Promise<void> {
    await this.clickElement(this.elements.modelSettingBtn)
  }

  async isTable(): Promise<boolean> {
    return this.elementShouldBeVisible(this.elements.tableRes)
  }

  async getTableInfo(): Promise<any> {
    const table = this.elements.tableRes
    const row = this.elements.rowTableRes
    const cell = this.elements.cellTableRes
    const textItem = this.elements.textCellTableRes
    const rowTable = table + row
    const cellRowtable = table + row + '[{0}]' + cell
    const textCellRowTable = cellRowtable + '[{1}]' + textItem + '[1]'
    var arr = new Array()
    const rowCount = await this.count(rowTable)
    for (let i = 1; i <= rowCount; i++) {
      const cellRowCount = await this.count(String.format(cellRowtable, i))
      const item = new Array()
      for (let j = 1; j <= cellRowCount; j++) {
        var text = ''
        try {
          text = await this.getText(String.format(textCellRowTable, i, j))
        } catch (error) {
          text = ''
        }
        item.push(text)
      }
      arr.push(item)
    }
    return arr
  }

  async tapThought(index: number = 1): Promise<void> {
    const thought = this.elements.thoughtBtn + '[' + index + ']'
    await this.clickElement(thought)
  }

  async isThought(index: number = 1): Promise<boolean> {
    const thought = this.elements.thoughtBtn + '[' + index + ']'
    return await this.elementShouldBeVisible(thought)
  }
  async isJanName(index: number = 1): Promise<boolean> {
    const thought = this.elements.janName + '[' + index + ']'
    return await this.elementShouldBeVisible(thought)
  }

  async getContentThought(index: number = 1): Promise<any> {
    const arr = new Array()
    const thought = this.elements.thoughtBtn + '[' + index + ']'
    const contentLocator = thought + this.elements.contentThought
    const thoughtCount = await this.count(contentLocator)
    for (let i = 1; i <= thoughtCount; i++) {
      const locator = contentLocator + '[' + i + ']'
      const text = await this.getText(locator)
      arr.push(text)
    }
    return arr
  }

  async getContent(partsRoot: string, textPartsRoot: string) {
    const arr = new Array()
    const partCount = await this.count(partsRoot)
    for (let i = 1; i <= partCount; i++) {
      const item = new Array()
      const textCount = await this.count(String.format(textPartsRoot, i))
      for (let j = 1; j <= textCount; j++) {
        var text = ''
        try {
          const textLocator = String.format(textPartsRoot + '[{1}]', i, j)
          text = await this.getText(textLocator)
        } catch (error) {
          text = ''
        }
        item.push(text)
      }
      arr.push(item)
    }
    return arr
  }

  async getContentResp(index: number = 1): Promise<any> {
    await this.waitForTimeout(3000)
    const janName = this.elements.janName + '[' + index + ']'
    const root = janName + this.elements.contentRoot
    const root2 = janName + this.elements.content2Root
    const parts = this.elements.contentParts
    const textItem = this.elements.contentText
    const partsRoot = root + parts
    const textPartsRoot2 = root2 + '[{0}]' + textItem
    const textPartsRoot = partsRoot + '[{0}]' + textItem
    var arr = new Array()
    const partCount = await this.count(partsRoot)
    if (partCount > 0) {
      arr = await this.getContent(partsRoot, textPartsRoot)
    } else {
      arr = await this.getContent(root2, textPartsRoot2)
    }
    return arr.filter(
      (item) => item.length > 0 && item[0] !== 'Scroll to bottom'
    )
  }

  async waitSendDone(time: number): Promise<any> {
    await this.waitUntilElementIsVisible(
      this.elements.sendButton + "[@enabled='false']",
      time
    )
  }

  async tapSend(): Promise<void> {
    await this.clickElement(this.elements.sendButton)
  }

  async getSendEnabled(): Promise<any> {
    return await this.getAttribute(this.elements.sendButton, 'enabled')
  }

  async getSendInputEnabled(): Promise<any> {
    return await this.getAttribute(this.elements.chatInput, 'enabled')
  }

  async tapBtnTool(name: string, index: number = 1): Promise<any> {
    var add = (await this.isThought()) ? 1 : 0
    var root = this.elements.janName + '[' + index + ']/following-sibling::'
    var locator = ''
    switch (name) {
      case toolResp.copy:
        locator = root + 'XCUIElementTypeButton[' + (1 + add) + ']'
        break
      case toolResp.delete:
        locator = root + 'XCUIElementTypeButton[' + (2 + add) + ']'
        break
      case toolResp.info:
        locator = root + 'XCUIElementTypePopUpButton[1]'
        break
      case toolResp.regenerate:
        locator = root + 'XCUIElementTypeButton[' + (3 + add) + ']'
        break
    }
    await this.clickElement(locator)
  }

  async tapBtnSendTool(message: string, name: string): Promise<void> {
    const msgSend = String.format(this.elements.messageSend, message)
    var root = msgSend + '/parent::*[1]/following-sibling::'
    var locator = ''
    switch (name) {
      case toolSend.edit:
        locator = root + 'XCUIElementTypePopUpButton[1]'
        break
      case toolSend.delete:
        locator = root + 'XCUIElementTypeButton[1]'
        break
    }
    await this.clickElement(locator)
  }

  async isMessageSend(message: string) {
    const locator = String.format(
      this.elements.messageSend +
        '/parent::*[1]/following-sibling::XCUIElementTypePopUpButton[1]',
      message
    )
    return await this.elementShouldBeVisible(locator)
  }

  async editMsgSend(message: string): Promise<void> {
    await this.enterText(this.elements.editSendInput, message)
    await this.clickElement(this.elements.saveBtn)
  }

  async getContentMetaData(): Promise<any> {
    return await this.getText(this.elements.contentMetaData)
  }

  async searchHistory(message: string): Promise<void> {
    await this.enterText(this.elements.searchHistoryInput, message)
  }

  async selectHistory(
    message: string,
    part: string = parts.recents
  ): Promise<void> {
    await this.searchHistory(message)
    const history = String.format(this.elements.history, part)
    const historyItem = history + "[@title='{0}' or @title='{1}']"
    const msgFormat = message.split('').join(' ')
    const locator = String.format(historyItem, message, msgFormat)
    await this.clickElement(locator)
  }

  async tapThreeDotsPart(part: string = parts.recents) {
    const locator = String.format(this.elements.threeDotsParts, part)
    await this.clickElement(locator)
  }

  async deleteAllHistory(): Promise<void> {
    const favorites = parts.favorites
    const recents = parts.recents
    const deleteAll = recentsMenu.deleteAll
    await this.enterText(this.elements.searchHistoryInput, '')
    const history = await this.getHistoryToPart()
    if (history.length > 0) {
      if (await this.isText(favorites)) {
        await this.unstarAllHistory()
      }
      await this.tapThreeDotsPart(recents)
      await this.tapText(deleteAll)
      await this.clickElement(this.elements.deleteBtn)
    }
  }

  async unstarAllHistory(): Promise<void> {
    const unstarAll = favoritesMenu.unstarAll
    const favorites = parts.favorites
    await this.tapThreeDotsPart(favorites)
    await this.tapText(unstarAll)
  }

  async deleteHistory(
    message: string,
    part: string = parts.recents
  ): Promise<void> {
    await this.selectHistoryMenu(message, btn.delete, part)
    await this.clickElement(this.elements.deleteBtn)
  }

  async tapThreeDotHistory(
    message: string,
    part: string = parts.recents
  ): Promise<void> {
    const history = String.format(this.elements.history, part)
    const historyItem = history + "[@title='{0}' or @title='{1}']"
    const msgFormat = message.split('').join(' ')
    const locator = String.format(historyItem, message, msgFormat)
    await this.clickElementByCoordinates(locator, 75)
  }

  async isHistory(
    message: string,
    part: string = parts.recents
  ): Promise<boolean> {
    const history = String.format(this.elements.history, part)
    const historyItem = history + "[@title='{0}' or @title='{1}']"
    const msgFormat = message.split('').join(' ')
    const locator = String.format(historyItem, message, msgFormat)
    return await this.elementShouldBeVisible(locator)
  }

  async selectHistoryMenu(
    message: string,
    name: string,
    part: string = parts.recents
  ) {
    await this.tapThreeDotHistory(message, part)
    await this.tapText(name)
  }

  async renameHistory(name: string): Promise<void> {
    await this.enterText(this.elements.renameHistoryInput, name)
    await this.clickElement(this.elements.renameBtn)
  }

  async getHistory(part: string): Promise<any> {
    const arr = new Array()
    const historyLocator = String.format(this.elements.history, part)
    const count = await this.count(historyLocator)
    for (let i = 1; i <= count; i++) {
      const locator = historyLocator + '[' + i + ']'
      const text = await this.getText(locator)
      arr.push(text)
    }
    return arr
  }

  async getHistoryToPart(part: string = parts.recents): Promise<any> {
    let arr = new Array()
    if (part == parts.favorites) {
      var favoritesArr = await this.getHistory(parts.favorites)
      var recentsArr = await this.getHistory(parts.recents)
      arr = favoritesArr.filter((item: any) => !recentsArr.includes(item))
    } else if (part == parts.recents) {
      arr = await this.getHistory(part)
    }
    return arr
  }

  async closeRecentsMenu(): Promise<void> {
    const locator = String.format(this.elementsCom.text, recentsMenu.deleteAll)
    await this.clickElementByCoordinates(locator, 150)
  }
}
