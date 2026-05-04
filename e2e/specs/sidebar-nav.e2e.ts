import { browser, $, expect } from '@wdio/globals'

/**
 * Sidebar navigation spec: clicks each instrumented sidebar entry and
 * asserts a downstream element appears. Stays UI-only; no model traffic.
 */
describe('Sidebar navigation', () => {
  before(async () => {
    await $('#root').waitForExist({ timeout: 30_000 })
  })

  it('opens the Settings page', async () => {
    const navSettings = await $('[data-testid="nav-settings"]')
    await navSettings.waitForClickable({ timeout: 15_000 })
    await navSettings.click()

    const page = await $('[data-testid="settings-page"]')
    await page.waitForDisplayed({ timeout: 15_000 })
    expect(await page.isDisplayed()).toBe(true)
  })

  it('opens the New Project dialog', async () => {
    const navNewProject = await $('[data-testid="nav-new-project"]')
    await navNewProject.waitForClickable({ timeout: 15_000 })
    await navNewProject.click()

    const dialog = await $('[data-testid="add-project-dialog"]')
    await dialog.waitForDisplayed({ timeout: 10_000 })
    expect(await dialog.isDisplayed()).toBe(true)

    // Dismiss so subsequent specs/its start from a clean state.
    await browser.keys('Escape')
    await dialog.waitForExist({ reverse: true, timeout: 5_000 })
  })

  it('navigates to a fresh chat from the sidebar', async () => {
    const navNewChat = await $('[data-testid="nav-new-chat"]')
    await navNewChat.waitForClickable({ timeout: 15_000 })
    await navNewChat.click()

    // The home route renders the chat composer even before any model is
    // selected; the textarea is the most reliable post-nav signal.
    const chatInput = await $('[data-testid="chat-input"]')
    await chatInput.waitForDisplayed({ timeout: 15_000 })
    expect(await chatInput.isDisplayed()).toBe(true)
  })

  it('disables the send button when the prompt is empty', async () => {
    const chatInput = await $('[data-testid="chat-input"]')
    await chatInput.waitForDisplayed({ timeout: 15_000 })
    await chatInput.setValue('')

    const sendBtn = await $('[data-testid="send-message-button"]')
    await sendBtn.waitForExist({ timeout: 10_000 })
    expect(await sendBtn.isEnabled()).toBe(false)

    await chatInput.setValue('hello')
    await browser.waitUntil(async () => sendBtn.isEnabled(), {
      timeout: 5_000,
      timeoutMsg: 'send-message-button never became enabled with non-empty prompt',
    })
    expect(await sendBtn.isEnabled()).toBe(true)

    // Reset so we don't leak state to other specs.
    await chatInput.setValue('')
  })
})
