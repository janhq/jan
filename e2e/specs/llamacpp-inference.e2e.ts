import { browser, $, $$, expect } from '@wdio/globals'

/**
 * Smoke test for the llama.cpp local inference path.
 *
 * Assumes a fresh app data dir (no models pre-installed). Run with:
 *   JAN_APP_DATA=$(mktemp -d) yarn workspace jan-e2e test
 * and have the Tauri build configured to honor JAN_APP_DATA, or point
 * the test at a disposable profile.
 *
 * Selectors below are placeholders — replace with stable data-testid
 * attributes once added to the Hub / Chat components.
 */
describe('llama.cpp inference', () => {
  it('downloads qwen3-0.6B from Hub and gets a chat reply', async () => {
    await $('#root').waitForExist({ timeout: 30_000 })

    // 1. Open Hub
    await (await $('[data-testid="nav-hub"]')).click()

    // 2. Search for the model. The Hub may need to download the
    //    "qwen3-0.6B" entry first — the Use button only appears after
    //    the model is downloaded.
    const search = await $('[data-testid="hub-search"]')
    await search.waitForDisplayed({ timeout: 10_000 })
    await search.setValue('qwen3-0.6B')

    // 3. If not yet downloaded, click the download icon and wait.
    const useBtn = await $('[data-testid="hub-use-button"]')
    if (!(await useBtn.isExisting())) {
      const dl = await $('[data-testid="hub-download-button"]')
      await dl.waitForClickable({ timeout: 15_000 })
      await dl.click()
      await useBtn.waitForExist({ timeout: 10 * 60_000 })
    }
    await useBtn.click()

    // 4. App redirects to chat
    const chatInput = await $('[data-testid="chat-input"]')
    await chatInput.waitForDisplayed({ timeout: 30_000 })

    // 5. Send a deterministic prompt
    await chatInput.setValue('Reply with the single word: pong')
    await browser.keys('Enter')

    // 6. Wait for an assistant message to appear and finish streaming
    await browser.waitUntil(
      async () => {
        const messages = await $$('[data-testid="assistant-message"]')
        if (messages.length === 0) return false
        const last = messages[messages.length - 1]
        const streaming = await last.getAttribute('data-streaming')
        const text = (await last.getText()).trim()
        return streaming === 'false' && text.length > 0
      },
      { timeout: 180_000, timeoutMsg: 'No completed assistant reply' }
    )

    const messages = await $$('[data-testid="assistant-message"]')
    const reply = (await messages[messages.length - 1].getText()).toLowerCase()
    expect(reply).toContain('pong')
  })
})
