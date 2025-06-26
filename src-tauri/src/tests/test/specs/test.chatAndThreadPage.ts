import * as dotenv from 'dotenv'
// interface
import { IHomePage } from '@interface/iHomePage'
import { IChatPage } from '@interface/iChatPage'
import { ISettingsPage } from '@interface/iSettingsPage'
// mac
import { HomePage as MacHomePage } from '@mac/homePage'
import { ChatPage as MacChatPage } from '@mac/chatPage'
import { SettingsPage as MacSettingsPage } from '@mac/settingsPage'
// win
import { HomePage as WinHomePage } from '@win/homePage'
import { ChatPage as WinChatPage } from '@win/chatPage'
import { SettingsPage as WinSettingsPage } from '@win/settingsPage'
// linux
import { HomePage as LinuxHomePage } from '@linux/homePage'
import { ChatPage as LinuxChatPage } from '@linux/chatPage'
import { SettingsPage as LinuxSettingsPage } from '@linux/settingsPage'

import { String } from 'typescript-string-operations'
import common from '@data/common.json'
import Utilities from '@core_lib/utilities'
import Flow from '@flow/flow'
dotenv.config()

let homePage: IHomePage
let chatPage: IChatPage
let settingsPage: ISettingsPage
const appInfo = common.appInfo
const gptv4 = common.models.gptv4dot5Preview
const models = common.models
const codeBlock = common.codeBlock
const notify = common.notify
const ui = common.ui
const toolResp = common.toolResp
const toolSend = common.toolSend
const parts = common.partThread
const recentsMenu = common.recentsMenu
const threadMenu = common.threadMenu
const btn = common.btn
const title = common.title
const modelSettings = common.title.modelSettings
const compare = common.compare
let flow: Flow
const utilities = new Utilities()
describe('Chat & Thread', () => {
  // before(async () => {
  //   if (process.env.RUNNING_OS === 'macOS') {
  //     homePage = new MacHomePage(driver)
  //     chatPage = new MacChatPage(driver)
  //     settingsPage = new MacSettingsPage(driver)
  //   } else if (process.env.RUNNING_OS === 'win') {
  //     homePage = new WinHomePage(driver)
  //     chatPage = new WinChatPage(driver)
  //     settingsPage = new WinSettingsPage(driver)
  //   } else if (process.env.RUNNING_OS === 'linux') {
  //     homePage = new LinuxHomePage(driver)
  //     chatPage = new LinuxChatPage(driver)
  //     settingsPage = new LinuxSettingsPage(driver)
  //   }
  //   flow = new Flow(driver)
  //   await homePage.activateApp(process.env.BUNDLE_ID)
  //   await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
  //   await homePage.setWindowBounds()
  //   await flow.configAPIKey(process.env.OPENAI || '')
  //   await flow.checkDownloadModels([
  //     models.qwen3v0dot6b,
  //     models.qwen3v1dot7b,
  //     models.qwen3v4b,
  //   ])
  // })
  // it('Validate model responses in table format.', async () => {
  //   const model = gptv4
  //   const msg = 'draw a table with 2 columns and rows'
  //   await flow.createThead(model, msg)
  //   expect(await chatPage.isTable()).toBe(true)
  // })
  // it('Check formatting of code responses and code block usage.', async () => {
  //   await flow.configCodeBlock(codeBlock.dark)
  //   const model = gptv4
  //   const msg = 'hello example in python'
  //   await flow.createThead(model, msg)
  //   //await .takeScreenshot()
  //   expect(await chatPage.isText(ui.python)).toBe(true)
  //   expect(await chatPage.isText(ui.copy)).toBe(true)
  // })
  // it('Validate long-form response from model.', async () => {
  //   const msg = 'generate a new story long any theme'
  //   const model = gptv4
  //   const response = await flow.createThead(model, msg)
  //   expect(response.content.length).toBeGreaterThan(0)
  // })
  // it('Validate model summary for long-form response.', async () => {
  //   const msg = 'summary this'
  //   await flow.sentAndWait(msg)
  //   const content = await chatPage.getContentResp(2)
  //   expect(content.length).toBeGreaterThan(0)
  // })
  // it('Successful deletion of requests from user /responses from model without issues', async () => {
  //   const msg = 'summarize further'
  //   await flow.sentAndWait(msg)
  //   await chatPage.tapBtnTool(toolResp.delete, 3)
  //   expect(await chatPage.isJanName(3)).toBe(false)
  //   await chatPage.tapBtnTool(toolResp.delete, 2)
  //   expect(await chatPage.isJanName(2)).toBe(false)
  // })
  // it("Model response generation stops completely when user clicks 'Stop' ", async () => {
  //   const model = gptv4
  //   const msg = 'generate a new story long any theme'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.sendMessage(msg)
  //   await chatPage.waitForTimeout(2000)
  //   await chatPage.tapSend()
  //   expect(await chatPage.getSendEnabled()).toBe('false')
  // })
  // it('Disable Send/Save button when input is empty.', async () => {
  //   const msg = 'generate a new story long any theme'
  //   await homePage.openNewChat()
  //   expect(await chatPage.getSendEnabled()).toBe('false')
  //   await chatPage.enterText(chatPage.elements.chatInput, msg)
  //   expect(await chatPage.getSendEnabled()).toBe('true')
  //   await chatPage.enterText(chatPage.elements.chatInput, '')
  //   expect(await chatPage.getSendEnabled()).toBe('false')
  // })
  // it('Display full user input for long messages.', async () => {
  //   const msg =
  //     'As the world becomes increasingly interconnected through globalization and the rapid development of digital communication technologies, cultures and societies are interacting with one another more frequently and intensely than ever before. While this has led to many positive outcomes, such as increased cultural exchange, improved access to information, and the fostering of international cooperation, it has also resulted in significant challenges, including the loss of cultural identity, the spread of misinformation, and increased economic inequality. Given this complex and multifaceted situation, to what extent do you believe that governments, educational institutions, and international organizations should intervene to manage the effects of globalization and digital transformation on cultural diversity, economic equity, and the well-being of future generations, and what specific strategies or policies do you think would be most effective in achieving these goals while still promoting innovation and progress?'
  //   await homePage.openNewChat()
  //   await chatPage.enterText(chatPage.elements.chatInput, msg)
  //   await chatPage.waitForTimeout(5000)
  //   const textInput = await chatPage.getText(chatPage.elements.chatInput)
  //   expect(msg).toBe(textInput)
  //   await chatPage.enterText(chatPage.elements.chatInput, '')
  // })
  // it('Message updates after editing and saving.', async () => {
  //   const model = gptv4
  //   const msg = 'generate 500/1000 words'
  //   const newMsg = 'generate 1000 words'
  //   await flow.createThead(model, msg)
  //   await chatPage.tapBtnSendTool(msg, toolSend.edit)
  //   await chatPage.editMsgSend(newMsg)
  //   const isNotify = await settingsPage.isNotify(
  //     notify.title.editMessage,
  //     notify.content.editMessageSuccess
  //   )
  //   expect(isNotify).toBe(true)
  //   expect(await chatPage.getSendEnabled()).toBe('true')
  //   await chatPage.waitSendDone(120000)
  //   expect(await chatPage.isText(newMsg)).toBe(true)
  // })
  // it('Sending messages with special characters or emojis.', async () => {
  //   const model = gptv4
  //   const msg = '😀😃😄😁😁. Hello!'
  //   const response = await flow.createThead(model, msg)
  //   expect(await chatPage.isText(msg)).toBe(true)
  //   expect(response.content.length).toBeGreaterThan(0)
  // })
  // it('Canceling edit restores the original message.', async () => {
  //   const model = gptv4
  //   const msg = 'Hello'
  //   const newMsg = 'Hello1'
  //   await flow.createThead(model, msg)
  //   expect(await chatPage.isText(msg)).toBe(true)
  //   await chatPage.tapBtnSendTool(msg, toolSend.edit)
  //   await chatPage.enterText(chatPage.elements.editSendInput, newMsg)
  //   await chatPage.clickElement(chatPage.elements.cancelBtn)
  //   await chatPage.waitForTimeout(1000)
  //   expect(await chatPage.isText(newMsg)).toBe(false)
  //   expect(await chatPage.isText(msg)).toBe(true)
  // })
  // it('Delete the message sent.', async () => {
  //   const model = gptv4
  //   const msg = 'Hello'
  //   await flow.createThead(model, msg)
  //   expect(await chatPage.isText(msg)).toBe(true)
  //   await chatPage.tapBtnSendTool(msg, toolSend.delete)
  //   expect(await chatPage.isMessageSend(msg)).toBe(false)
  // })
  // it('Delete multiple sent messages.', async () => {
  //   const model = gptv4
  //   const msg1 = 'Hello1'
  //   const msg2 = 'Hello2'
  //   await flow.createThead(model, msg1)
  //   await flow.sentAndWait(msg2)
  //   await chatPage.tapBtnSendTool(msg1, toolSend.delete)
  //   expect(await chatPage.isMessageSend(msg1)).toBe(false)
  //   await chatPage.tapBtnSendTool(msg2, toolSend.delete)
  //   expect(await chatPage.isMessageSend(msg2)).toBe(false)
  // })
  // it('Display JSON metadata on clicking the metadata icon.', async () => {
  //   const model = gptv4
  //   const msg = 'Hello'
  //   await flow.createThead(model, msg)
  //   await chatPage.tapBtnTool(toolResp.info)
  //   const metaData = await chatPage.getContentMetaData()
  //   await chatPage.clickElement(chatPage.elements.closeBtn)
  //   expect(() => JSON.parse(metaData)).not.toThrow()
  // })
  // it('Allow copying response content.', async () => {
  //   const model = models.qwen3v4b
  //   const msg = 'Hello'
  //   const response = await flow.createThead(model, msg)
  //   await chatPage.tapBtnTool(toolResp.copy, 1)
  //   expect(await chatPage.isText(ui.copied)).toBe(true)
  //   await chatPage.clickElement(chatPage.elements.chatInput)
  //   await chatPage.pasteText()
  //   const thought = response.thought[0]
  //   const content = response.content[0][0]
  //   const textExpect = '<think>' + thought + '</think>' + content
  //   const textInput = await chatPage.getText(chatPage.elements.chatInput)
  //   expect(textInput).toBe(textExpect)
  //   await chatPage.enterText(chatPage.elements.chatInput, '')
  // })
  // it('App redirects correctly when a link is clicked.', async () => {
  //   const model = gptv4
  //   const msg = 'What is Google link? Please provide full google.com link'
  //   const link = 'https://www.google.com'
  //   await flow.createThead(model, msg)
  //   await chatPage.tapText(link)
  //   await chatPage.waitForTimeout(3000)
  //   const urlBrower = await chatPage.getBrowserUrl()
  //   expect(urlBrower).toBe(link + '/')
  //   await chatPage.focusApp(appInfo.name)
  // })
  // it('Chat with invalid API key remote provider.', async () => {
  //   const key = 'invalid'
  //   const model = gptv4
  //   const msg = 'Hello'
  //   await flow.configAPIKey(key)
  //   await flow.createThead(model, msg)
  //   expect(
  //     await chatPage.isNotify(notify.content.incorrectAPIKeyProvided)
  //   ).toBe(true)
  // })
  // it('Chat with valid API key remote provider.', async () => {
  //   const key = process.env.OPENAI || ''
  //   const model = gptv4
  //   const msg = 'Test'
  //   await homePage.openNewChat()
  //   await flow.configAPIKey(key)
  //   const response = await flow.createThead(model, msg)
  //   expect(response.content.length).toBeGreaterThan(0)
  // })
  // it('Display latest selected model name after switching.', async () => {
  //   const msg1 = 'Hello'
  //   const msg2 = 'Hello 1'
  //   const model1 = gptv4
  //   const model2 = models.qwen3v4b
  //   const response1 = await flow.createThead(model1, msg1)
  //   expect(response1.content.length).toBeGreaterThan(0)
  //   await chatPage.selectModel(model2)
  //   await flow.sentAndWait(msg2)
  //   const content2 = await chatPage.getContentResp(2)
  //   expect(content2.length).toBeGreaterThan(0)
  //   await chatPage.tapThought()
  //   const thought2 = await chatPage.getContentThought()
  //   await chatPage.tapThought()
  //   expect(thought2.length).toBeGreaterThan(0)
  //   expect(await chatPage.isTextContains(model2)).toBe(true)
  // })
  // it("Show 'Loading Model...' and disable input during sending.", async () => {
  //   const model1 = models.qwen3v0dot6b
  //   const model2 = models.qwen3v1dot7b
  //   const msg1 = 'Content 1'
  //   const msg2 = 'Content 2'
  //   await flow.goToModelProviders()
  //   await settingsPage.toggle(title.autoUnloadOldModels, true)
  //   let modelsStatus = await flow.getStatusModels([model1, model2])
  //   expect(modelsStatus[model1]).toBe(btn.start)
  //   expect(modelsStatus[model2]).toBe(btn.start)
  //   await homePage.openNewChat()
  //   await flow.waitLoadingModel(model1, msg1)
  //   await flow.goToModelProviders()
  //   modelsStatus = await flow.getStatusModels([model1, model2])
  //   expect(modelsStatus[model1]).toBe(btn.stop)
  //   expect(modelsStatus[model2]).toBe(btn.start)
  //   await homePage.openNewChat()
  //   await flow.waitLoadingModel(model2, msg2)
  //   await flow.goToModelProviders()
  //   modelsStatus = await flow.getStatusModels([model1, model2])
  //   expect(modelsStatus[model1]).toBe(btn.start)
  //   expect(modelsStatus[model2]).toBe(btn.stop)
  //   await settingsPage.toggle(title.autoUnloadOldModels, false)
  //   await homePage.openNewChat()
  //   await flow.waitLoadingModel(model1, msg1)
  //   await flow.waitLoadingModel(model2, msg2)
  //   await flow.goToModelProviders()
  //   modelsStatus = await flow.getStatusModels([model1, model2])
  //   expect(modelsStatus[model1]).toBe(btn.stop)
  //   expect(modelsStatus[model2]).toBe(btn.stop)
  // })
  // it('Verify thread switching retains correct model and content.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const model1 = gptv4
  //   const model2 = models.qwen3v4b
  //   await chatPage.deleteAllHistory()
  //   const content1 = await flow.createThead(model1, msg1)
  //   const content2 = await flow.createThead(model2, msg2)
  //   await chatPage.selectHistory(msg1)
  //   const contentThread1 = await flow.getResponse()
  //   expect(await chatPage.isTextContains(model1)).toBe(true)
  //   expect(await chatPage.isText(msg1)).toBe(true)
  //   expect(contentThread1).toStrictEqual(content1)
  //   await chatPage.selectHistory(msg2)
  //   const contentThread2 = await flow.getResponse()
  //   expect(await chatPage.isTextContains(model2)).toBe(true)
  //   expect(await chatPage.isText(msg2)).toBe(true)
  //   expect(contentThread2).toStrictEqual(content2)
  // })
  // it('Verify thread switching retains correct model and content.', async () => {
  //   const msg = 'Test3'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   const content = await flow.createThead(model, msg)
  //   await chatPage.quitApp(appInfo.name)
  //   await chatPage.wait(3000)
  //   await chatPage.openApp(appInfo.address)
  //   await chatPage.wait(2000)
  //   await chatPage.focusApp(appInfo.name)
  //   await chatPage.selectHistory(msg)
  //   const contentThread = await flow.getResponse()
  //   expect(await chatPage.isTextContains(model)).toBe(true)
  //   expect(await chatPage.isText(msg)).toBe(true)
  //   expect(contentThread).toStrictEqual(content)
  // })
  // it('Regenerate response multiple times to ensure relevance.', async () => {
  //   const msg = 'Test3'
  //   const model = gptv4
  //   let content
  //   if (!(await chatPage.isText(msg))) {
  //     content = await flow.createThead(model, msg)
  //   } else {
  //     await chatPage.selectHistory(msg)
  //     content = await flow.getResponse()
  //   }
  //   await chatPage.tapBtnTool(toolResp.regenerate)
  //   const contentThread1 = await flow.getResponse()
  //   expect(contentThread1).not.toStrictEqual(content)
  //   await chatPage.tapBtnTool(toolResp.regenerate)
  //   const contentThread2 = await flow.getResponse()
  //   expect(contentThread2).not.toStrictEqual(content)
  // })
  // it('Update thread name after renaming.', async () => {
  //   const msg = 'Test3'
  //   const newMsg = 'Test4'
  //   const model = gptv4
  //   if (!(await chatPage.isText(msg))) {
  //     await flow.createThead(model, msg)
  //   } else {
  //     await chatPage.selectHistory(msg)
  //     await flow.getResponse()
  //   }
  //   await chatPage.selectHistoryMenu(msg, threadMenu.rename)
  //   await chatPage.renameHistory(newMsg)
  //   const isNotify = await settingsPage.isNotify(
  //     notify.title.renameThread,
  //     String.format(notify.content.renameThreadSuccess, newMsg)
  //   )
  //   expect(isNotify).toBe(true)
  //   expect(await chatPage.isHistory(newMsg)).toBe(true)
  // })
  // it('New thread shows under Recent by default.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   const history = await chatPage.getHistoryToPart()
  //   expect(history[0]).toBe(msg2)
  //   expect(history[1]).toBe(msg1)
  // })
  // it('Starred thread moves to Favorites.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   await chatPage.selectHistoryMenu(msg1, threadMenu.star)
  //   const favoritesHistory = await chatPage.getHistoryToPart('Favorites')
  //   expect(favoritesHistory[0]).toBe(msg1)
  //   console.log(favoritesHistory)
  //   const recentsHistory = await chatPage.getHistoryToPart('Recents')
  //   expect(recentsHistory[0]).toBe(msg2)
  // })
  // it('Unstarred thread returns to Recent.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   await chatPage.selectHistoryMenu(msg1, threadMenu.star)
  //   await chatPage.selectHistoryMenu(msg1, threadMenu.unstar, parts.favorites)
  //   const recentsHistory = await chatPage.getHistoryToPart(parts.recents)
  //   expect(await chatPage.isText(parts.favorites)).toBe(false)
  //   expect(recentsHistory[0]).toBe(msg2)
  //   expect(recentsHistory[1]).toBe(msg1)
  // })
  // it('Show exact thread on exact name search.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   await chatPage.searchHistory(msg1)
  //   expect(await chatPage.isText(parts.recents)).toBe(true)
  //   const recentsHistory1 = await chatPage.getHistoryToPart(parts.recents)
  //   expect(recentsHistory1.length).toBe(1)
  //   expect(recentsHistory1[0]).toBe(msg1.split('').join(' '))
  //   await chatPage.searchHistory(msg2)
  //   expect(await chatPage.isText(parts.recents)).toBe(true)
  //   const recentsHistory2 = await chatPage.getHistoryToPart(parts.recents)
  //   expect(recentsHistory1.length).toBe(1)
  //   expect(recentsHistory2[0]).toBe(msg2.split('').join(' '))
  // })
  // it('Show partial matches when searching thread names.', async () => {
  //   const keyword = 'test'
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const msg3 = 'Hello'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   await flow.createThead(model, msg3)
  //   await chatPage.searchHistory(keyword)
  //   expect(await chatPage.isText(parts.recents)).toBe(true)
  //   const recentsHistory = await chatPage.getHistoryToPart(parts.recents)
  //   expect(recentsHistory.length).toBe(2)
  //   expect(recentsHistory[0]).toBe(msg2.split('').join(' '))
  //   expect(recentsHistory[1]).toBe(msg1.split('').join(' '))
  //   expect(await chatPage.isText(msg3.split('').join(' '))).toBe(false)
  // })
  // it('Thread search is case-insensitive.', async () => {
  //   const keywords = ['hello', 'Hello', 'hELLO']
  //   const msg1 = 'TEST3'
  //   const msg2 = 'TEST4'
  //   const msg3 = 'HELLO'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   await flow.createThead(model, msg3)
  //   for (let i = 0; i < keywords.length; i++) {
  //     const keyword = keywords[i]
  //     await chatPage.searchHistory(keyword)
  //     expect(await chatPage.isText(parts.recents)).toBe(true)
  //     const recentsHistory = await chatPage.getHistoryToPart(parts.recents)
  //     expect(recentsHistory.length).toBe(1)
  //     expect(recentsHistory[0]).toBe(msg3.split('').join(' '))
  //     expect(await chatPage.isText(msg1.split('').join(' '))).toBe(false)
  //     expect(await chatPage.isText(msg2.split('').join(' '))).toBe(false)
  //   }
  // })
  // it('Cancel delete thread is kept intact.', async () => {
  //   const msg = 'Test3'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg)
  //   const history = await chatPage.getHistoryToPart()
  //   await chatPage.selectHistoryMenu(msg, btn.delete)
  //   await chatPage.tapText(btn.cancel)
  //   await chatPage.waitForTimeout(1000)
  //   const historyAfter = await chatPage.getHistoryToPart()
  //   expect(history).toStrictEqual(historyAfter)
  // })
  // it('Thread is permanently deleted on user action.', async () => {
  //   const msg = 'Test3'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg)
  //   await chatPage.deleteHistory(msg)
  //   const isNotify = await settingsPage.isNotify(
  //     notify.title.deleteThread,
  //     notify.content.deleteThreadSuccess
  //   )
  //   expect(isNotify).toBe(true)
  // })
  // it('Cancel delete all threads are kept intact.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const msg3 = 'Hello'
  //   const model = gptv4
  //   await chatPage.enterText(chatPage.elements.searchHistoryInput, '')
  //   let history = await chatPage.getHistoryToPart()
  //   if (history.length == 0) {
  //     await flow.createThead(model, msg1)
  //     await flow.createThead(model, msg2)
  //     await flow.createThead(model, msg3)
  //   }
  //   history = await chatPage.getHistoryToPart()
  //   await chatPage.tapThreeDotsPart()
  //   await chatPage.tapText(recentsMenu.deleteAll)
  //   await chatPage.clickElement(chatPage.elements.cancelBtn)
  //   await chatPage.closeRecentsMenu()
  //   await chatPage.waitForTimeout(1000)
  //   const historyAfter = await chatPage.getHistoryToPart()
  //   expect(history).toStrictEqual(historyAfter)
  // })
  // it('Delete All removes all recent threads permanently.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const msg3 = 'Hello'
  //   const model = gptv4
  //   const history = await chatPage.getHistoryToPart()
  //   if (history.length == 0) {
  //     await flow.createThead(model, msg1)
  //     await flow.createThead(model, msg2)
  //     await flow.createThead(model, msg3)
  //   }
  //   await chatPage.deleteAllHistory()
  //   const isNotify = await settingsPage.isNotify(
  //     notify.title.deleteAllThreads,
  //     notify.content.deleteAllThreadSuccess
  //   )
  //   expect(isNotify).toBe(true)
  //   expect(await chatPage.isText(ui.noThreadsYet)).toBe(true)
  //   expect(await chatPage.isText(ui.noThreadsYetDetail)).toBe(true)
  // })
  // it('Unstar all thread returns to Recent.', async () => {
  //   const msg1 = 'Test3'
  //   const msg2 = 'Test4'
  //   const msg3 = 'Hello'
  //   const model = gptv4
  //   await chatPage.deleteAllHistory()
  //   await flow.createThead(model, msg1)
  //   await flow.createThead(model, msg2)
  //   await flow.createThead(model, msg3)
  //   await chatPage.selectHistoryMenu(msg1, threadMenu.star)
  //   await chatPage.selectHistoryMenu(msg2, threadMenu.star)
  //   await chatPage.selectHistoryMenu(msg3, threadMenu.star)
  //   await chatPage.unstarAllHistory()
  //   const isNotify = await settingsPage.isNotify(
  //     notify.title.allThreadsUnfavorited,
  //     notify.content.allThreadsUnfavoritedSuccess
  //   )
  //   expect(isNotify).toBe(true)
  //   expect(await chatPage.isText(parts.favorites)).toBe(false)
  // })
  // it('Can open setting model on chat page.', async () => {
  //   const model = models.qwen3v0dot6b
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   expect(await chatPage.isText('Model Settings - ' + model)).toBe(true)
  // })
  // it('Can close setting model on chat page.', async () => {
  //   const model = models.qwen3v0dot6b
  //   const modelSettings = 'Model Settings - ' + model
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   expect(await chatPage.isText(modelSettings)).toBe(true)
  //   await settingsPage.closeSettingModel(model)
  //   await settingsPage.waitForTimeout(1000)
  //   expect(await chatPage.isText(modelSettings)).toBe(false)
  //   await chatPage.tapModelSetting()
  //   expect(await chatPage.isText(modelSettings)).toBe(true)
  //   await chatPage.clickAtPoint(200, 200)
  //   await settingsPage.waitForTimeout(1000)
  //   expect(await chatPage.isText(modelSettings)).toBe(false)
  // })
  // it("Set the model's 'GPU Layers' when sent and check if it has been applied", async () => {
  //   const model = models.qwen3v4b
  //   const msg = 'Hello'
  //   const gpuLayers1 = '-1'
  //   const gpuLayers2 = '50'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.gpuLayers, gpuLayers1)
  //   const responseTime1 = await utilities.measureResponseTime(
  //     'Send with GPU Layers:' + gpuLayers1,
  //     async () => {
  //       await flow.sentAndWait(msg)
  //     }
  //   )
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.gpuLayers, gpuLayers2)
  //   const responseTime2 = await utilities.measureResponseTime(
  //     'Send with GPU Layers:' + gpuLayers2,
  //     async () => {
  //       await flow.sentAndWait(msg)
  //     }
  //   )
  //   expect(responseTime1).toBeLessThan(responseTime2)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.gpuLayers, '100')
  // })
  // it("Set the model's 'Temperature' when sent and check if it has been applied", async () => {
  //   const model = models.qwen3v4b
  //   const msg = 'What is the capital of England? a little information'
  //   const temperature = ['0', '10']
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   const object: any = {}
  //   for (let i = 0; i < temperature.length; i++) {
  //     await chatPage.tapModelSetting()
  //     await flow.changeSettingModel(modelSettings.temperature, temperature[i])
  //     await flow.sentAndWait(msg)
  //     const contentAndThought = await flow.getResponse(i + 1)
  //     const key = temperature[i] == '10' ? 'more1' : 'equal0'
  //     object[key] = {
  //       thought: contentAndThought.thought[0],
  //       content: contentAndThought.content[0][0],
  //     }
  //   }
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.temperature, '0.7')
  //   const expectCompare = [compare.text1Complex, compare.similar]
  //   const compareThought = utilities.compareTextComplexityWithConfidence(
  //     object['more1'].thought,
  //     object['equal0'].thought
  //   )
  //   const compareContent = utilities.compareTextComplexityWithConfidence(
  //     object['more1'].content,
  //     object['equal0'].content
  //   )
  //   expect(expectCompare).toContain(compareThought.compare)
  //   expect(expectCompare).toContain(compareContent.compare)
  // })
  // it("Set the model's 'Top K' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const topK = '40'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.topK, topK)
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  // })
  // it("Set the model's 'Top P' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const topP = '0.8'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.topP, topP)
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  // })
  // it("Set the model's 'Min P' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const minP = '0.1'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.minP, minP)
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  // })
  // it("Set the model's 'Repeat Last N' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const repeatLastN = '64'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.repeatLastN, repeatLastN)
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  //   await flow.changeSettingModel(modelSettings.repeatLastN, '')
  // })
  // it("Set the model's 'Repeat Penalty' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const repeatPenalty = '1.0'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(modelSettings.repeatPenalty, repeatPenalty)
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  //   await flow.changeSettingModel(modelSettings.repeatPenalty, '')
  // })
  // it("Set the model's 'Presence Penalty' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const presencePenalty = '0'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(
  //     modelSettings.presencePenalty,
  //     presencePenalty
  //   )
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  //   await flow.changeSettingModel(modelSettings.presencePenalty, '')
  // })
  // it("Set the model's 'Frequency Penalty' when sent and check if it has been applied", async () => {
  //   const msg = 'Hello'
  //   const model = models.qwen3v4b
  //   const frequencyPenalty = '0.1'
  //   await homePage.openNewChat()
  //   await chatPage.selectModel(model)
  //   await chatPage.tapModelSetting()
  //   await flow.changeSettingModel(
  //     modelSettings.frequencyPenalty,
  //     frequencyPenalty
  //   )
  //   await flow.sentAndWait(msg)
  //   const response = await flow.getResponse()
  //   expect(response.content.length).toBeGreaterThan(0)
  //   await flow.changeSettingModel(modelSettings.frequencyPenalty, '')
  // })
})
