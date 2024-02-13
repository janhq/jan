import { Page, expect } from '@playwright/test'
import { CommonActions } from './commonActions'

export class BasePage {
  private dataMap = new Map()

  constructor(
    protected readonly page: Page,
    readonly action: CommonActions,
    protected readonly menuId: string,
    protected readonly containerId: string
  ) {}

  public getValue(key: string) {
    return this.action.getValue(key)
  }

  public setValue(key: string, value: string) {
    this.action.setValue(key, value)
  }

  async takeScreenshot(name: string='') {
    await this.action.takeScreenshot(name)
  }

  async navigateByMenu() {
    await this.page.getByTestId(this.menuId).first().click()
  }

  async verifyContainerVisible() {
    const container = this.page.getByTestId(this.containerId)
    expect(container.isVisible()).toBeTruthy()
  }
}
