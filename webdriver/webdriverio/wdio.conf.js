const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

// keep track of the `tauri-driver` child process
let tauriDriver

exports.config = {
  specs: ['./test/specs/home.e2e.ts'],
  maxInstances: 1,
  port: 4445,
  capabilities: [
    {
      'browserName': '',
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

  // ensure the rust project is built since we expect this binary to exist for the webdriver sessions
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

  // ensure we are running `tauri-driver` before the session starts so that we can proxy the webdriver requests
  beforeSession: () => {
    const driverPath = path.resolve(
      os.homedir(),
      '.cargo',
      'bin',
      'tauri-driver'
    )
    tauriDriver = spawn(driverPath, ['--port', '4455'], { stdio: 'pipe' })

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

  // clean up the `tauri-driver` process we spawned at the start of the session
  afterSession: () => tauriDriver.kill(),
}
