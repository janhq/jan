describe('Jan-nano-gguf download and use flow', () => {
  it('should download and use Jan-nano-gguf from the Hub', async () => {
    // Click the Hub button
    const hubButton = await $('[data-test-id="menu-common:hub"]')
    await hubButton.waitForDisplayed({ timeout: 60000 })
    await hubButton.click()

    // Click Jan-nano-gguf
    const nanoItem = await $(
      '[data-test-id="hub-model-Menlo:Jan-nano-gguf:jan-nano-4b-iQ4_XS.gguf"]'
    )
    await nanoItem.waitForDisplayed({ timeout: 240000 })
    // Check if 'Use' button is already displayed
    const useButton = await $('button*=Use')
    const isUseDisplayed = await useButton.isDisplayed().catch(() => false)

    if (isUseDisplayed) {
      await useButton.click()
    } else {
      // Click Download inside Jan-nano-gguf
      const downloadButton = await $('button*=Download')
      await downloadButton.waitForDisplayed({ timeout: 5000 })
      await downloadButton.click()

      // Wait for 'Use' text/button to appear, then click it
      await useButton.waitForDisplayed({ timeout: 120000 })
      await useButton.click()
    }

    // Try send a message
    const chatInput = await $('[data-test-id="chat-input"]')
    await chatInput.waitForDisplayed({ timeout: 120000 })
    await chatInput.setValue('Hello, Jan-nano-gguf!')
    const sendButton = await $('[data-test-id="send-message-button"]')
    await sendButton.waitForDisplayed({ timeout: 5000 })
    await sendButton.click()
    // Wait for the response to appear
    const responseText = await $('[data-test-id^="message-assistant-"]')
    await responseText.waitForDisplayed({ timeout: 120000 })
    const responseContent = await responseText.getText()
    // Check if the response content is not empty
    // expect length > 0
    expect(responseContent.length).toBeGreaterThan(0)
  })
})
