import path from 'path'
import { appResourcePath, getJanDataFolderPath, log, SystemInformation } from '@janhq/core/node'
import { ProcessWatchdog } from './watchdog'
import { readdir, symlink } from 'fs/promises'

// The HOST address to use for the Nitro subprocess
const LOCAL_PORT = '39291'
let watchdog: ProcessWatchdog | undefined = undefined

/**
 * Spawns a Nitro subprocess.
 * @returns A promise that resolves when the Nitro subprocess is started.
 */
function run(systemInfo?: SystemInformation): Promise<any> {
  log(`[CORTEX]:: Spawning cortex subprocess...`)

  return new Promise<void>(async (resolve, reject) => {
    let gpuVisibleDevices = systemInfo?.gpuSetting?.gpus_in_use.join(',') ?? ''
    let binaryName = `cortex-server${process.platform === 'win32' ? '.exe' : ''}`
    const binPath = path.join(__dirname, '..', 'bin')
    await createEngineSymlinks(binPath)
    
    const executablePath = path.join(binPath, binaryName)
    const sharedPath = path.join(
      appResourcePath(),
      'shared'
    )
    // Execute the binary
    log(`[CORTEX]:: Spawn cortex at path: ${executablePath}`)

    const dataFolderPath = getJanDataFolderPath()
    if (watchdog) {
      watchdog.terminate()
    }

    watchdog = new ProcessWatchdog(
      executablePath,
      [
        '--start-server',
        '--port',
        LOCAL_PORT.toString(),
        '--config_file_path',
        `${path.join(dataFolderPath, '.janrc')}`,
        '--data_folder_path',
        dataFolderPath,
      ],
      {
        env: {
          ...process.env,
          CUDA_VISIBLE_DEVICES: gpuVisibleDevices,
          // Vulkan - Support 1 device at a time for now
          ...(gpuVisibleDevices?.length > 0 && {
            GGML_VK_VISIBLE_DEVICES: gpuVisibleDevices,
          }),
        },
        cwd: sharedPath,
      }
    )
    watchdog.start()
    resolve()
  })
}

/**
 * Create symlinks for the engine shared libraries
 * @param binPath 
 */
async function createEngineSymlinks(binPath: string) {
  const sharedPath = path.join(appResourcePath(), 'shared')
  const sharedLibFiles = await readdir(sharedPath)
  for (const sharedLibFile of sharedLibFiles) {
    if (sharedLibFile.endsWith('.dll') || sharedLibFile.endsWith('.so')) {
      const targetDllPath = path.join(sharedPath, sharedLibFile)
      const symlinkDllPath = path.join(binPath, sharedLibFile)
      await symlink(targetDllPath, symlinkDllPath).catch(console.error)
      console.log(`Symlink created: ${targetDllPath} -> ${symlinkDllPath}`)
    }
  }
}

/**
 * Every module should have a dispose function
 * This will be called when the extension is unloaded and should clean up any resources
 * Also called when app is closed
 */
function dispose() {
  watchdog?.terminate()
}

function addEnvPaths(dest: string) {
  // Add engine path to the PATH and LD_LIBRARY_PATH
  if (process.platform === 'win32') {
    process.env.PATH = (process.env.PATH || '').concat(path.delimiter, dest)
  } else {
    process.env.LD_LIBRARY_PATH = (process.env.LD_LIBRARY_PATH || '').concat(
      path.delimiter,
      dest
    )
  }
}

/**
 * Cortex process info
 */
export interface CortexProcessInfo {
  isRunning: boolean
}

export default {
  run,
  dispose,
}
