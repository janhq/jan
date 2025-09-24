console.log('Downloading Windows installer dependencies...')
// scripts/download-win-installer-deps.mjs
import https from 'https'
import fs, { mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
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

async function main() {
  console.log('Starting Windows installer dependencies download')
  const platform = os.platform() // 'darwin', 'linux', 'win32'
  const arch = os.arch() // 'x64', 'arm64', etc.

  if (arch != 'x64') return


  const libDir = 'src-tauri/resources/lib'
  const tempDir = 'scripts/dist'

  try {
    mkdirSync('scripts/dist')
  } catch (err) {
    // Expect EEXIST error if the directory already exists
  }

  // Download VC++ Redistributable 17
  if (platform == 'win32') {
    const vcFilename = 'vc_redist.x64.exe'
    const vcUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
    
    console.log(`Downloading VC++ Redistributable...`)
    const vcSavePath = path.join(tempDir, vcFilename)
    if (!fs.existsSync(vcSavePath)) {
      await download(vcUrl, vcSavePath)
    }

    // copy to tauri resources
    try {
      copySync(vcSavePath, libDir)
    } catch (err) {
      // Expect EEXIST error
    }
  }

  console.log('Windows installer dependencies downloads completed.')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
