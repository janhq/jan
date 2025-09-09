import BasePage from './base.page.js'

/**
 * Chat page object
 */
class ChatPage extends BasePage {
  // Selectors - Exact selectors from Jan app codebase
  get newChatButton() { return '[data-test-id="menu-common:newChat"]' }
  get newChatButtonFallback() { return 'a[href="/"] svg.tabler-icon-circle-plus-filled' }
  get chatInput() { return '[data-testid="chat-input"]' }
  get sendButton() { return '[data-test-id="send-message-button"]' }
  get chatMessages() { return '[data-test-id^="message-"]' }
  get threadsList() { return 'aside.text-left-panel-fg.overflow-hidden' }
  get searchInput() { return 'input[placeholder*="Search"].w-full.pl-7.pr-8.py-1.bg-left-panel-fg\\/10.rounded-sm' }
  get menuContainer() { return '.space-y-1.shrink-0.py-1.mt-2' }

  /**
   * Start a new chat
   */
  async startNewChat() {
    // Try primary selector first, then fallback
    if (await this.elementExists(this.newChatButton)) {
      await this.clickElement(this.newChatButton)
    } else if (await this.elementExists(this.newChatButtonFallback)) {
      await this.clickElement(this.newChatButtonFallback)
    }
    await browser.pause(1000) // Wait for new chat to initialize
  }

  /**
   * Send a message
   * @param {string} message - Message to send
   */
  async sendMessage(message) {
    await this.waitForElement(this.chatInput)
    const input = await $(this.chatInput)
    await input.setValue(message)
    
    if (await this.elementExists(this.sendButton)) {
      await this.clickElement(this.sendButton)
    } else {
      // Try pressing Enter if no send button
      await input.keys('Enter')
    }
    
    await browser.pause(2000) // Wait for message to be sent
  }

  /**
   * Get chat messages
   */
  async getChatMessages() {
    await browser.pause(1000) // Wait for messages to load
    const messageSelectors = [
      '[data-testid="chat-message"]',
      '.message',
      '.chat-message',
      '[role="log"] > div',
      '.prose'
    ]

    for (const selector of messageSelectors) {
      const messages = await $$(selector)
      if (messages.length > 0) {
        const messageTexts = []
        for (const message of messages) {
          const text = await message.getText()
          if (text && text.trim()) {
            messageTexts.push(text.trim())
          }
        }
        return messageTexts
      }
    }
    
    return []
  }

  /**
   * Wait for response
   */
  async waitForResponse(timeout = 30000) {
    // Wait for loading indicator to appear and disappear, or for new message
    const loadingSelectors = [
      '[data-testid="loading"]',
      '.loading',
      '.spinner',
      '.generating'
    ]
    
    // Wait for any loading indicator to appear
    for (const selector of loadingSelectors) {
      if (await this.elementExists(selector)) {
        await browser.waitUntil(async () => {
          const element = await $(selector)
          return !(await element.isDisplayed())
        }, {
          timeout,
          timeoutMsg: 'Response took too long to complete'
        })
        break
      }
    }
    
    await browser.pause(2000) // Additional wait for response to fully load
  }

  /**
   * Verify chat interface elements are visible
   */
  async verifyChatInterfaceVisible() {
    const essentialElements = [
      { selector: this.chatInput, name: 'chat input' },
      { selector: this.newChatButton, name: 'new chat button' }
    ]

    const results = []
    for (const element of essentialElements) {
      const isVisible = await this.elementExists(element.selector)
      results.push({ name: element.name, visible: isVisible })
    }

    return results
  }

  /**
   * Get thread list
   */
  async getThreadList() {
    if (await this.elementExists(this.threadItem)) {
      const threads = await $$(this.threadItem)
      const threadTexts = []
      
      for (const thread of threads) {
        const text = await thread.getText()
        if (text && text.trim()) {
          threadTexts.push(text.trim())
        }
      }
      
      return threadTexts
    }
    
    return []
  }

  /**
   * Verify basic chat functionality works
   */
  async verifyBasicChatFunctionality() {
    await this.startNewChat()
    
    // Send a simple test message
    const testMessage = "Hello, this is a test message"
    await this.sendMessage(testMessage)
    
    // Get all messages and verify our message is there
    const messages = await this.getChatMessages()
    const hasOurMessage = messages.some(msg => msg.includes("Hello, this is a test"))
    
    return {
      messageSent: hasOurMessage,
      totalMessages: messages.length,
      messages: messages
    }
  }
}

export default new ChatPage()