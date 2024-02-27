import { writeFileSync, existsSync, readFileSync } from 'fs'
import { exec, spawn } from 'child_process'
import path from 'path'
import { getJanDataFolderPath, log } from '@janhq/core/node'

/**
 * Default GPU settings
 * TODO: This needs to be refactored to support multiple accelerators
 **/
const DEFALT_SETTINGS = {
  notify: true,
  run_mode: 'cpu',
  nvidia_driver: {
    exist: false,
    version: '',
  },
  cuda: {
    exist: false,
    version: '',
  },
  gpus: [],
  gpu_highest_vram: '',
  gpus_in_use: [],
  is_initial: true,
  // TODO: This needs to be set based on user toggle in settings
  vulkan: false
}

/**
 * Path to the settings file
 **/
export const GPU_INFO_FILE = path.join(
  getJanDataFolderPath(),
  'settings',
  'settings.json'
)

/**
 * Current nitro process
 */
let nitroProcessInfo: NitroProcessInfo | undefined = undefined

/**
 * Nitro process info
 */
export interface NitroProcessInfo {
  isRunning: boolean
}

/**
 * This will retrive GPU informations and persist settings.json
 * Will be called when the extension is loaded to turn on GPU acceleration if supported
 */
export async function updateNvidiaInfo() {
  if (process.platform !== 'darwin') {
    let data
    try {
      data = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
    } catch (error) {
      data = DEFALT_SETTINGS
      writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
    }
    updateNvidiaDriverInfo()
    updateGpuInfo()
  }
}

/**
 * Retrieve current nitro process
 */
export const getNitroProcessInfo = (subprocess: any): NitroProcessInfo => {
  nitroProcessInfo = {
    isRunning: subprocess != null,
  }
  return nitroProcessInfo
}

/**
 * Validate nvidia and cuda for linux and windows
 */
export async function updateNvidiaDriverInfo(): Promise<void> {
  exec(
    'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
    (error, stdout) => {
      let data = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))

      if (!error) {
        const firstLine = stdout.split('\n')[0].trim()
        data['nvidia_driver'].exist = true
        data['nvidia_driver'].version = firstLine
      } else {
        data['nvidia_driver'].exist = false
      }

      writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
      Promise.resolve()
    }
  )
}

/**
 * Check if file exists in paths
 */
export function checkFileExistenceInPaths(
  file: string,
  paths: string[]
): boolean {
  return paths.some((p) => existsSync(path.join(p, file)))
}

/**
 * Validate cuda for linux and windows
 */
export function updateCudaExistence(
  data: Record<string, any> = DEFALT_SETTINGS
): Record<string, any> {
  let filesCuda12: string[]
  let filesCuda11: string[]
  let paths: string[]
  let cudaVersion: string = ''

  if (process.platform === 'win32') {
    filesCuda12 = ['cublas64_12.dll', 'cudart64_12.dll', 'cublasLt64_12.dll']
    filesCuda11 = ['cublas64_11.dll', 'cudart64_11.dll', 'cublasLt64_11.dll']
    paths = process.env.PATH ? process.env.PATH.split(path.delimiter) : []
  } else {
    filesCuda12 = ['libcudart.so.12', 'libcublas.so.12', 'libcublasLt.so.12']
    filesCuda11 = ['libcudart.so.11.0', 'libcublas.so.11', 'libcublasLt.so.11']
    paths = process.env.LD_LIBRARY_PATH
      ? process.env.LD_LIBRARY_PATH.split(path.delimiter)
      : []
    paths.push('/usr/lib/x86_64-linux-gnu/')
  }

  let cudaExists = filesCuda12.every(
    (file) => existsSync(file) || checkFileExistenceInPaths(file, paths)
  )

  if (!cudaExists) {
    cudaExists = filesCuda11.every(
      (file) => existsSync(file) || checkFileExistenceInPaths(file, paths)
    )
    if (cudaExists) {
      cudaVersion = '11'
    }
  } else {
    cudaVersion = '12'
  }

  data['cuda'].exist = cudaExists
  data['cuda'].version = cudaVersion
  console.debug(data['is_initial'], data['gpus_in_use'])
  if (cudaExists && data['is_initial'] && data['gpus_in_use'].length > 0) {
    data.run_mode = 'gpu'
  }
  data.is_initial = false
  return data
}

/**
 * Get GPU information
 */
export async function updateGpuInfo(): Promise<void> {
  let data = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))

  // Cuda
  if (data['vulkan'] === true) {
    // Vulkan
    exec(
      process.platform === 'win32'
        ? `${__dirname}\\..\\bin\\vulkaninfoSDK.exe --summary`
        : `${__dirname}/../bin/vulkaninfo --summary`,
      (error, stdout) => {
        if (!error) {
          const output = stdout.toString()
          log(output)
          const gpuRegex = /GPU(\d+):(?:[\s\S]*?)deviceName\s*=\s*(.*)/g

          let gpus = []
          let match
          while ((match = gpuRegex.exec(output)) !== null) {
            const id = match[1]
            const name = match[2]
            gpus.push({ id, vram: 0, name })
          }
          data.gpus = gpus

          if (!data['gpus_in_use'] || data['gpus_in_use'].length === 0) {
            data.gpus_in_use = [data.gpus.length > 1 ? '1' : '0']
          }

          data = updateCudaExistence(data)
          writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
        }
        Promise.resolve()
      }
    )
  } else {
    exec(
      'nvidia-smi --query-gpu=index,memory.total,name --format=csv,noheader,nounits',
      (error, stdout) => {
        if (!error) {
          log(stdout)
          // Get GPU info and gpu has higher memory first
          let highestVram = 0
          let highestVramId = '0'
          let gpus = stdout
            .trim()
            .split('\n')
            .map((line) => {
              let [id, vram, name] = line.split(', ')
              vram = vram.replace(/\r/g, '')
              if (parseFloat(vram) > highestVram) {
                highestVram = parseFloat(vram)
                highestVramId = id
              }
              return { id, vram, name }
            })

          data.gpus = gpus
          data.gpu_highest_vram = highestVramId
        } else {
          data.gpus = []
          data.gpu_highest_vram = ''
        }

        if (!data['gpus_in_use'] || data['gpus_in_use'].length === 0) {
          data.gpus_in_use = [data['gpu_highest_vram']]
        }

        data = updateCudaExistence(data)
        writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
        Promise.resolve()
      }
    )
  }
}
