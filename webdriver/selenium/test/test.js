const os = require('os')
const path = require('path')
const { expect } = require('chai')
const { spawn, spawnSync } = require('child_process')
const { Builder, By, until, Capabilities } = require('selenium-webdriver')

// Path to the Tauri app binary after build
const application = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src-tauri',
  'target',
  'debug',
  'Jan'
)

// WebDriver and Tauri driver instances
let driver
let tauriDriver

before(async function () {
  this.timeout(180000) // long timeout to allow build if needed

  // Build frontend and backend
  spawnSync('yarn', ['build:web'], {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    stdio: 'inherit',
    shell: true,
  })
  spawnSync('cargo', ['build', '--features', 'tauri/custom-protocol'], {
    cwd: path.resolve(__dirname, '..', '..', '..', 'src-tauri'),
    stdio: 'inherit',
  })

  // Start tauri-driver
  tauriDriver = spawn(
    path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver'),
    [],
    { stdio: [null, process.stdout, process.stderr] }
  )

  // Set capabilities
  const capabilities = new Capabilities()
  capabilities.set('tauri:options', {
    application,
    webviewOptions: {
      additionalBrowserArguments: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=EdgeIdentity',
        '--disable-sync',
        '--guest',
      ],
    },
  })
  capabilities.setBrowserName('wry')

  // Initialize WebDriver session
  driver = await new Builder()
    .withCapabilities(capabilities)
    .usingServer('http://127.0.0.1:4444/')
    .build()
})

after(async function () {
  if (driver) await driver.quit()
  if (tauriDriver) tauriDriver.kill()
})

describe('Jan-nano-gguf download and use flow', function () {
  this.timeout(300000) // 5 minutes

  it('should download and use Jan-nano-gguf from the Hub', async () => {
    // Click the Hub button
    const hubButton = await driver.wait(
      until.elementLocated(By.css('[data-test-id="menu-common:hub"]')),
      60000
    )
    await hubButton.click()

    // Click Jan-nano-gguf
    const nanoItem = await driver.wait(
      until.elementLocated(
        By.css(
          '[data-test-id="hub-model-Menlo:Jan-nano-gguf:jan-nano-4b-iQ4_XS.gguf"]'
        )
      ),
      240000
    )

    let useButton
    try {
      // Try to find and click the 'Use' button
      useButton = await driver.findElement(
        By.xpath('//button[contains(text(), "Use")]')
      )
      await useButton.click()
    } catch (err) {
      // If 'Use' button is not found, download the model first
      const downloadButton = await driver.wait(
        until.elementLocated(
          By.xpath('//button[contains(text(), "Download")]')
        ),
        5000
      )
      await downloadButton.click()

      // Wait for 'Use' button to appear and click it
      useButton = await driver.wait(
        until.elementLocated(By.xpath('//button[contains(text(), "Use")]')),
        120000
      )
      await useButton.click()
    }

    // Enter a message in the chat input
    const chatInput = await driver.wait(
      until.elementLocated(By.css('[data-test-id="chat-input"]')),
      120000
    )
    await chatInput.sendKeys('Hello, Jan-nano-gguf!')

    // Click the send button
    const sendButton = await driver.wait(
      until.elementLocated(By.css('[data-test-id="send-message-button"]')),
      5000
    )
    await sendButton.click()

    // Wait for the assistant's message to appear
    const responseText = await driver.wait(
      until.elementLocated(By.css('[data-test-id^="message-assistant-"]')),
      120000
    )
    const responseContent = await responseText.getText()

    // Check that the response is not empty
    expect(responseContent.length).to.be.greaterThan(0)
  })
})
