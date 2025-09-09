import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// keep track of the `tauri-driver` child process
let tauriDriver
let exit = false

// Get the path to the built Tauri application
const getAppPath = () => {
  const platform = os.platform()
  
  if (platform === 'darwin') {
    console.error('❌ E2E testing is not supported on macOS')
    process.exit(1)
  }
  
  if (platform === 'win32') {
    return '../../src-tauri/target/debug/Jan.exe'
  } else {
    return '../../src-tauri/target/debug/Jan'
  }
}

export const config = {
  host: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.spec.js'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: getAppPath(),
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  
  logLevel: 'info',
  waitforTimeout: 30000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  
  // Inject globals automatically
  injectGlobals: true,

  // check if the app binary exists before starting tests
  onPrepare: async () => {
    const appPath = path.resolve(__dirname, getAppPath())
    const fs = await import('fs')
    
    if (!fs.existsSync(appPath)) {
      console.error(`Tauri app not found at: ${appPath}`)
      console.error('Please run: make e2e-build (or mise run e2e-build)')
      process.exit(1)
    }

    console.log('Tauri app found at:', appPath)
  },

  // ensure we are running `tauri-driver` before the session starts so that we can proxy the webdriver requests
  beforeSession: () => {
    const tauriDriverPath = os.platform() === 'win32' 
      ? path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver.exe')
      : path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver')
    
    tauriDriver = spawn(
      tauriDriverPath,
      [],
      { stdio: [null, process.stdout, process.stderr] }
    )

    tauriDriver.on('error', (error) => {
      console.error('tauri-driver error:', error)
      process.exit(1)
    })
    
    tauriDriver.on('exit', (code) => {
      if (!exit) {
        console.error('tauri-driver exited with code:', code)
        process.exit(1)
      }
    })
  },

  // clean up the `tauri-driver` process we spawned at the start of the session
  // note that afterSession might not run if the session fails to start, so we also run the cleanup on shutdown
  afterSession: () => {
    closeTauriDriver()
  },
}

function closeTauriDriver() {
  exit = true
  tauriDriver?.kill()
}

function onShutdown(fn) {
  const cleanup = () => {
    try {
      fn()
    } finally {
      process.exit()
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
  process.on('SIGBREAK', cleanup)
}

// ensure tauri-driver is closed when our test process exits
onShutdown(() => {
  closeTauriDriver()
})