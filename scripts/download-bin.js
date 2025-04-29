console.log('Script is running')
// scripts/download.js
import https from 'https'
import fs, { mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
import unzipper from 'unzipper'
import tar from 'tar'
import { copySync } from 'cpx'

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} to ${dest}`)
    const file = fs.createWriteStream(dest)
    https
      .get(url, (response) => {
        console.log(`Response status code: ${response.statusCode}`)
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          // Handle redirect
          const redirectURL = response.headers.location
          console.log(`Redirecting to ${redirectURL}`)
          download(redirectURL, dest).then(resolve, reject) // Recursive call
          return
        } else if (response.statusCode !== 200) {
          reject(`Failed to get '${url}' (${response.statusCode})`)
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close(resolve)
        })
      })
      .on('error', (err) => {
        fs.unlink(dest, () => reject(err.message))
      })
  })
}

async function decompress(filePath, targetDir) {
  console.log(`Decompressing ${filePath} to ${targetDir}`)
  if (filePath.endsWith('.zip')) {
    await fs
      .createReadStream(filePath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .promise()
  } else if (filePath.endsWith('.tar.gz')) {
    await tar.x({
      file: filePath,
      cwd: targetDir,
    })
  } else {
    throw new Error(`Unsupported archive format: ${filePath}`)
  }
}

function getPlatformArch() {
  const platform = os.platform() // 'darwin', 'linux', 'win32'
  const arch = os.arch() // 'x64', 'arm64', etc.

  let bunPlatform, uvPlatform

  if (platform === 'darwin') {
    bunPlatform = arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86'
    uvPlatform =
      arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  } else if (platform === 'linux') {
    bunPlatform = arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64'
    uvPlatform = 'unknown-x86_64-linux-aarch64-gnu' // Add aarch64 support if needed
  } else if (platform === 'win32') {
    bunPlatform = 'windows-x86_64' // Bun has limited Windows support
    uvPlatform = 'windows'
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  return { bunPlatform, uvPlatform }
}

async function main() {
  console.log('Starting main function')
  const { bunPlatform, uvPlatform } = getPlatformArch()
  console.log(`bunPlatform: ${bunPlatform}, uvPlatform: ${uvPlatform}`)

  const binDir = 'src-tauri/resources/bin'
  const tempBinDir = 'scripts/dist'
  const bunPath = `${tempBinDir}/bun-${bunPlatform}.zip`
  const uvPath = `${tempBinDir}/uv-${uvPlatform}.tar.gz`
  try {
    mkdirSync('scripts/dist')
  } catch (err) {
    // Expect EEXIST error if the directory already exists
  }

  // Adjust these URLs based on latest releases
  const bunVersion = '1.2.10' // Example Bun version
  const bunUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-${bunPlatform}.zip`

  const uvVersion = '0.6.17' // Example UV version
  const uvUrl = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/uv-${uvPlatform}.tar.gz`

  console.log(`Downloading Bun for ${bunPlatform}...`)
  await download(bunUrl, path.join(tempBinDir, `bun-${bunPlatform}.zip`))
  await decompress(bunPath, tempBinDir)
  try {
    copySync(
      path.join(tempBinDir, `bun-${bunPlatform}`, 'bun'),
      path.join(binDir)
    )
  } catch (err) {
    // Expect EEXIST error
  }
  try {
    copySync(
      path.join(tempBinDir, `bun-${bunPlatform}`, 'bun.exe'),
      path.join(binDir)
    )
  } catch (err) {
    // Expect EEXIST error
  }
  console.log('Bun downloaded.')

  console.log(`Downloading UV for ${uvPlatform}...`)
  await download(uvUrl, path.join(tempBinDir, `uv-${uvPlatform}.tar.gz`))
  await decompress(uvPath, tempBinDir)
  try {
    copySync(
      path.join(tempBinDir, `uv-${uvPlatform}`, 'uv'),
      path.join(binDir)
    )
  } catch (err) {
    // Expect EEXIST error
  }
  try {
    copySync(
      path.join(tempBinDir, `uv-${uvPlatform}`, 'uv.exe'),
      path.join(binDir)
    )
  } catch (err) {
    // Expect EEXIST error
  }
  console.log('UV downloaded.')

  console.log('Downloads completed.')
}

// Ensure the downloads directory exists
if (!fs.existsSync('downloads')) {
  fs.mkdirSync('downloads')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
