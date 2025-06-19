import { IBasePage } from "@interface/iBasePage";

export type ChatPageElements = {
  chatInput: string;
  sendButton: string;
  modelBtn: string;
  modelSettingBtn: string;
  searchModelInput: string;
  modelItem: string;
  tableRes: string;
  rowTableRes: string;
  colTableRes: string;
  cellTableRes: string;
  textCellTableRes: string;
  janName: string;
  thoughtBtn: string;
  contentThought: string;
  contentRoot: string;
  content2Root: string;
  contentParts: string;
  contentText: string;
  messageSend: string;
  editSendInput: string;
  closeEditSendBtn: string;
  cancelBtn: string;
  saveBtn: string;
  contentMetaData: string;
  closeMetaDataBtn: string;
  closeBtn: string;
  searchHistoryInput: string;
  threeDotsParts: string;
  history: string;
  closeDeleteAllBtn: string;
  closeDeleteThreadBtn: string;
  deleteBtn: string;
  renameHistoryInput: string;
  closeRenameHistoryBtn: string;
  renameBtn: string;
};

export interface IChatPage extends IBasePage {
  elements: ChatPageElements;

  /**
   * Sends a message in the chat input
   * @param message The message to send
   * @returns Promise that resolves when the message is sent
   */
  sendMessage(message: string): Promise<void>;

  /**
   * Verifies if the chat input is visible
   * @returns Promise that resolves when the verification is completed
   */
  verifyChatInputVisible(): Promise<void>;
  selectModel(model: string): Promise<void>;
  tapModelSetting(): Promise<void>;
  isTable(): Promise<boolean>;
  getTableInfo(): Promise<any>;
  tapThought(index?: number): Promise<void>;
  isThought(index?: number): Promise<boolean>;
  isJanName(index?: number): Promise<boolean>;
  getContentThought(index?: number): Promise<any>;
  getContentResp(index?: number): Promise<any>;
  waitSendDone(time: number): Promise<any>;
  tapSend(): Promise<void>;
  getSendEnabled(): Promise<any>;
  getSendInputEnabled(): Promise<any>;
  tapBtnTool(name: string, index?: number): Promise<void>;
  tapBtnSendTool(message: string, name: string): Promise<void>;
  isMessageSend(message: string): Promise<boolean>;
  editMsgSend(message: string): Promise<void>;
  getContentMetaData(): Promise<any>;
  searchHistory(message: string): Promise<void>;
  selectHistory(message: string, part?: string): Promise<void>;
  deleteAllHistory(): Promise<void>;
  unstarAllHistory(): Promise<void>;
  deleteHistory(message: string, part?: string): Promise<void>;
  tapThreeDotsPart(part?: string): Promise<void>;
  tapThreeDotHistory(message: string, part?: string): Promise<void>;
  selectHistoryMenu(
    message: string,
    name: string,
    part?: string
  ): Promise<void>;
  renameHistory(name: string): Promise<void>;
  isHistory(message: string, part?: string): Promise<boolean>;
  getHistoryToPart(part?: string): Promise<any>;
  closeRecentsMenu(): Promise<void>;
}
