import { readFileSync } from 'fs'
import * as path from 'path'
import { GPU_INFO_FILE } from './accelerator'

export interface NitroExecutableOptions {
  executablePath: string
  cudaVisibleDevices: string
  vkVisibleDevices: string
}
/**
 * Find which executable file to run based on the current platform.
 * @returns The name of the executable file to run.
 */
export const executableNitroFile = (): NitroExecutableOptions => {
  let binaryFolder = path.join(__dirname, '..', 'bin') // Current directory by default
  let cudaVisibleDevices = ''
  let vkVisibleDevices = ''
  let binaryName = 'nitro'
  /**
   * The binary folder is different for each platform.
   */
  if (process.platform === 'win32') {
    /**
     *  For Windows: win-cpu, win-vulkan, win-cuda-11-7, win-cuda-12-0
     */
    let gpuInfo = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
    if (gpuInfo['run_mode'] === 'cpu') {
      binaryFolder = path.join(binaryFolder, 'win-cpu')
    } else {
      if (gpuInfo['cuda']?.version === '11') {
        binaryFolder = path.join(binaryFolder, 'win-cuda-11-7')
      } else {
        binaryFolder = path.join(binaryFolder, 'win-cuda-12-0')
      }
      cudaVisibleDevices = gpuInfo['gpus_in_use'].join(',')
    }
    if (gpuInfo['vulkan'] === true) {
      binaryFolder = path.join(__dirname, '..', 'bin')
      binaryFolder = path.join(binaryFolder, 'win-vulkan')
      vkVisibleDevices = gpuInfo['gpus_in_use'].toString()
    }
    binaryName = 'nitro.exe'
  } else if (process.platform === 'darwin') {
    /**
     *  For MacOS: mac-arm64 (Silicon), mac-x64 (InteL)
     */
    if (process.arch === 'arm64') {
      binaryFolder = path.join(binaryFolder, 'mac-arm64')
    } else {
      binaryFolder = path.join(binaryFolder, 'mac-x64')
    }
  } else {
    /**
     *  For Linux: linux-cpu, linux-vulkan, linux-cuda-11-7, linux-cuda-12-0
     */
    let gpuInfo = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
    if (gpuInfo['run_mode'] === 'cpu') {
      binaryFolder = path.join(binaryFolder, 'linux-cpu')
    } else {
      if (gpuInfo['cuda']?.version === '11') {
        binaryFolder = path.join(binaryFolder, 'linux-cuda-11-7')
      } else {
        binaryFolder = path.join(binaryFolder, 'linux-cuda-12-0')
      }
      cudaVisibleDevices = gpuInfo['gpus_in_use'].join(',')
    }

    if (gpuInfo['vulkan'] === true) {
      binaryFolder = path.join(__dirname, '..', 'bin')
      binaryFolder = path.join(binaryFolder, 'linux-vulkan')
      vkVisibleDevices = gpuInfo['gpus_in_use'].toString()
    }
  }
  return {
    executablePath: path.join(binaryFolder, binaryName),
    cudaVisibleDevices,
    vkVisibleDevices,
  }
}
