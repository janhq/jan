import { expect } from '@playwright/test'
import { test } from '../config/fixtures'
import { seedData } from '../seeds/seed-message'

test('migrate data', async ({ page }) => {
   
    await page.waitForLoadState('load');
    await page.addInitScript(() => {
        localStorage.setItem('didShowMigrationWarning', 'false');
    });
    const appDataFolder = await page.evaluate(() => (window as any).electronAPI.appDataFolder());
    const {threads: seedThreads, messages: seedMessages } = await seedData(appDataFolder)
    await page.reload();
    
    await page.waitForTimeout(3000)
    await page.click('text=Migrate Now')
    await page.waitForTimeout(10000)
    await page.click('text=Done')
    
    const response = await page.request.get('http://127.0.0.1:1338/v1/threads')
      expect(response.ok()).toBeTruthy();
      const responseBody = await response.json();
      const threads = responseBody.data.filter((thread: any) => seedThreads.some((seedThread: any) => seedThread.title === thread.title))
      expect(threads.length).toBe(seedThreads.length);
    for (const thread of threads) {
        const response = await page.request.get(`http://127.0.0.1:1338/v1/threads/${thread.id}/messages`)
        expect(response.ok()).toBeTruthy();
        const messageResponseBody = await response.json();
        const messages = messageResponseBody.data.filter((message: any) => message.thread_id === thread.id)
        expect(messages.length).toBe(seedMessages.filter((seedMessage: any) => seedMessage.thread_id === thread.id).length)
        // check if the messages are the same content
        for (const message of messages) {
            const seedMessage = seedMessages.find((seedMessage: any) => seedMessage.id === message.id)
            expect(seedMessage).toBeTruthy()
            expect(seedMessage?.content[0].text.value).toBe(message?.content[0].text.value)
        }
    }
})
