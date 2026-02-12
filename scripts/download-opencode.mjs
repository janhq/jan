// scripts/download-opencode.mjs
import https from 'https'
import fs from 'fs'
import os from 'os'
import path from 'path'
import tar from 'tar'

// Configuration
const OPENCODE_VERSION = 'v0.1.0-jan.1'
const OPENCODE_REPO = 'Vanalite/opencode'

const PLATFORM_MAP = {
  'darwin-arm64': 'universal-apple-darwin',
  'darwin-x64': 'universal-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}`)
    const file = fs.createWriteStream(dest)
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          download(response.headers.location, dest).then(resolve, reject)
          return
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => file.close(resolve))
      })
      .on('error', (err) => {
        fs.unlink(dest, () => reject(err))
      })
  })
}

async function main() {
  if (process.env.SKIP_OPENCODE) {
    console.log('Skipping OpenCode download (SKIP_OPENCODE set)')
    return
  }

  const platform = os.platform()
  const arch = os.arch()
  const key = `${platform}-${arch}`
  const target = PLATFORM_MAP[key]

  if (!target) {
    console.error(`Unsupported platform: ${key}`)
    process.exit(1)
  }

  const binDir = path.join('src-tauri', 'resources', 'bin')
  const binaryName = platform === 'win32' ? 'opencode.exe' : 'opencode'
  const binaryPath = path.join(binDir, binaryName)

  // Check if already exists
  if (fs.existsSync(binaryPath)) {
    console.log(`OpenCode already exists at ${binaryPath}`)
    return
  }

  fs.mkdirSync(binDir, { recursive: true })

  const url = `https://github.com/${OPENCODE_REPO}/releases/download/${OPENCODE_VERSION}/opencode-${target}.tar.gz`
  const tempDir = path.join('scripts', 'dist')
  const archivePath = path.join(tempDir, `opencode-${target}.tar.gz`)

  fs.mkdirSync(tempDir, { recursive: true })

  console.log(`Downloading OpenCode ${OPENCODE_VERSION} for ${target}...`)
  await download(url, archivePath)

  console.log('Extracting...')
  await tar.x({ file: archivePath, cwd: tempDir })

  // Copy binary to bin directory
  const extractedBinary = path.join(tempDir, binaryName)
  fs.copyFileSync(extractedBinary, binaryPath)
  fs.chmodSync(binaryPath, 0o755)

  // Create platform-specific copies for Tauri sidecar
  const tauriTarget = target.replace('universal-apple-darwin', 'aarch64-apple-darwin')
  const tauriBinaryPath = path.join(binDir, `opencode-${tauriTarget}${platform === 'win32' ? '.exe' : ''}`)
  fs.copyFileSync(binaryPath, tauriBinaryPath)

  if (platform === 'darwin') {
    // Also create x86_64 copy for universal binary
    fs.copyFileSync(binaryPath, path.join(binDir, 'opencode-x86_64-apple-darwin'))
  }

  console.log(`OpenCode ${OPENCODE_VERSION} installed successfully`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})