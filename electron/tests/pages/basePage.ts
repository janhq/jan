import { Page, expect } from '@playwright/test'
import { CommonActions } from './commonActions'
import { TIMEOUT } from '../config/fixtures'

export class BasePage {
  menuId: string

  constructor(
    protected readonly page: Page,
    readonly action: CommonActions,
    protected containerId: string
  ) {}

  public getValue(key: string) {
    return this.action.getValue(key)
  }

  public setValue(key: string, value: string) {
    this.action.setValue(key, value)
  }

  async takeScreenshot(name: string = '') {
    await this.action.takeScreenshot(name)
  }

  async navigateByMenu() {
    await this.page.getByTestId(this.menuId).first().click()
  }

  async verifyContainerVisible() {
    const container = this.page.getByTestId(this.containerId)
    expect(container.isVisible()).toBeTruthy()
  }

  async waitUpdateLoader() {
    await this.isElementVisible('img[alt="Jan - Logo"]')
  }

  //wait and find a specific element with it's selector and return Visible
  async isElementVisible(selector: any) {
    let isVisible = true
    await this.page
      .waitForSelector(selector, { state: 'visible', timeout: TIMEOUT })
      .catch(() => {
        isVisible = false
      })
    return isVisible
  }
}
