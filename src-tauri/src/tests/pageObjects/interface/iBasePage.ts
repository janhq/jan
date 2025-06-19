import type { ElementReference } from "@wdio/protocols";
export type BaseElements = {
  text: string;
  textContains: string;
};

/**
 * Interface defining the common methods and properties that all page objects should implement.
 */
export interface IBasePage {
  elementsCom: BaseElements;
  /** */
  waitForTimeout(timeout: number): Promise<void>;
  waitUntilElementIsVisible(selector: string, timeout?: number): Promise<void>;
  getElement(selector: string): Promise<ElementReference>;
  activateApp(bundleId?: string): Promise<void>;
  clickElement(selector: string): Promise<void>;
  clickElementByCoordinates(
    selector: string,
    addCenterX?: number,
    addCenterY?: number
  ): Promise<void>;
  clickAtPoint(x: number, y: number): Promise<void>;
  scrollToElement(selector: string): Promise<void>;
  sendKeys(selector: string, keys: string): Promise<void>;
  enterText(selector: string, text: string): Promise<void>;
  terminateApp(bundleId?: string): Promise<void>;
  elementShouldBeVisible(selector: string): Promise<boolean>;
  getActiveWindowName(): Promise<string>;
  setWindowBounds(
    top?: number,
    left?: number,
    width?: number,
    height?: number
  ): Promise<void>;
  uploadFile(filePath: string): Promise<boolean>;
  getText(selector: string): Promise<any>;
  getAttribute(selector: string, attribute: string): Promise<any>;
  count(selector: string): Promise<number>;
  isText(text: string): Promise<boolean>;
  isTextContains(text: string): Promise<boolean>;
  waitText(text: string, timeout?: number): Promise<void>;
  waitTextContains(text: string, timeout?: number): Promise<void>;
  isNotify(title: string, detail?: string): Promise<boolean>;
  pasteText(): Promise<void>;
  tapText(text: string): Promise<void>;
  getBrowserUrl(browser?: string): Promise<string>;
  focusApp(appName: string): Promise<void>;
  quitApp(appName: string): Promise<void>;
  openApp(appPath: string): Promise<void>;
  wait(timeout: number): Promise<any>;
}
