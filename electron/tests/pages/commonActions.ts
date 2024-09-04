import { promisify } from 'util';
import { Page, TestInfo } from '@playwright/test'
import { page } from '../config/fixtures'
import { exec } from 'child_process';

const execPromise = promisify(exec);

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

  async downloadFileWithCurl(url: string, savePath: string, timeout: number): Promise<void> {
    try {
      const curlCommand = `curl -o "${savePath}" "${url}"`;

      const { stdout, stderr } = await execPromise(curlCommand);

      if (stderr) {
        console.error(`Error downloading the file: ${stderr}`);
        throw new Error(stderr);
      }

      console.log(`File downloaded successfully to ${savePath}`);
    } catch (error) {
      console.error(`Failed to download the file: ${error.message}`);
      throw error;
    }
  }
}
