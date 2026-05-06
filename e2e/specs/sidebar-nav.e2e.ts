import { browser, expect } from '@wdio/globals'
import { byTestId, clickNav, dismissDialog, waitForApp } from '../helpers/app'

/**
 * Sidebar navigation spec: clicks each instrumented sidebar entry and
 * asserts a downstream element appears. Stays UI-only; no model traffic.
 */
describe('Sidebar navigation', () => {
  before(async () => {
    await waitForApp()
  })

  it('opens the Settings page', async () => {
    await clickNav('settings')
    const page = await byTestId('settings-page')
    expect(await page.isDisplayed()).toBe(true)
  })

  it('opens the New Project dialog', async () => {
    await clickNav('new-project')
    const dialog = await byTestId('add-project-dialog', 10_000)
    expect(await dialog.isDisplayed()).toBe(true)
    await dismissDialog('add-project-dialog')
  })

  it('navigates to a fresh chat from the sidebar', async () => {
    await clickNav('new-chat')
    const chatInput = await byTestId('chat-input')
    expect(await chatInput.isDisplayed()).toBe(true)
  })

  it('disables the send button when the prompt is empty', async () => {
    const chatInput = await byTestId('chat-input')
    await chatInput.setValue('')

    const sendBtn = await byTestId('send-message-button', 10_000)
    expect(await sendBtn.isEnabled()).toBe(false)

    await chatInput.setValue('hello')
    await browser.waitUntil(async () => sendBtn.isEnabled(), {
      timeout: 5_000,
      timeoutMsg: 'send-message-button never became enabled with non-empty prompt',
    })
    expect(await sendBtn.isEnabled()).toBe(true)

    await chatInput.setValue('')
  })
})
