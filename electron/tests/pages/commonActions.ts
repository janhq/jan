import { Page, TestInfo } from '@playwright/test'
import { page } from '../config/fixtures'

export class CommonActions {
  private testData = new Map<string, string>()

  constructor(
    public page: Page,
    public testInfo: TestInfo
  ) {}

  async takeScreenshot(name: string) {
    const screenshot = await page.screenshot({
      fullPage: true,
    })
    const attachmentName = `${this.testInfo.title}_${name || new Date().toISOString().slice(5, 19).replace(/[-:]/g, '').replace('T', '_')}`
    await this.testInfo.attach(attachmentName.replace(/\s+/g, ''), {
      body: screenshot,
      contentType: 'image/png',
    })
  }

  async hooks() {
    console.log('hook from the scenario page')
  }

  setValue(key: string, value: string) {
    this.testData.set(key, value)
  }

  getValue(key: string) {
    return this.testData.get(key)
  }
}
