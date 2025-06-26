const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

let tauriDriver
const isWindows = os.platform() === 'win32'
const tauriPort = isWindows ? 4445 : 4444

exports.config = {
  specs: ['./test/specs/home.e2e.ts'],
  maxInstances: 1,
  port: tauriPort,
  capabilities: [
    {
      'tauri:options': {
        application: path.resolve(
          __dirname,
          '../../src-tauri/target/debug/Jan'
        ),
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  onPrepare: () => {
    spawnSync('yarn', ['build:web'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'inherit',
      shell: true,
    })
    spawnSync('cargo', ['build', '--features', 'tauri/custom-protocol'], {
      cwd: path.resolve(__dirname, '../../src-tauri'),
      stdio: 'inherit',
    })
  },

  beforeSession: () => {
    const driverPath = path.resolve(
      os.homedir(),
      '.cargo',
      'bin',
      'tauri-driver'
    )
    const args = ['--port', tauriPort.toString()]
    if (isWindows) {
      args.push('--native-driver', 'C:\\tools\\webdrivers\\msedgedriver.exe')
    }

    tauriDriver = spawn(driverPath, args, { stdio: 'pipe' })

    if (tauriDriver && tauriDriver.stdout && tauriDriver.stderr) {
      tauriDriver.stdout.on('data', (data) => {
        console.log('[tauri-driver]', data.toString())
      })
      tauriDriver.stderr.on('data', (data) => {
        console.error('[tauri-driver error]', data.toString())
      })
    } else {
      console.error('[tauri-driver] Failed to spawn or attach stdout/stderr')
    }
  },

  afterSession: () => {
    if (tauriDriver) {
      tauriDriver.kill()
    }
  },
}
