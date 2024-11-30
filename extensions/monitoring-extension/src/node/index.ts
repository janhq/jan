import {
  GpuSetting,
  GpuSettingInfo,
  LoggerManager,
  OperatingSystemInfo,
  ResourceInfo,
  SupportedPlatforms,
  getJanDataFolderPath,
  log,
} from '@janhq/core/node'
import { mem, cpu } from 'node-os-utils'
import { exec } from 'child_process'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import { FileLogger } from './logger'

/**
 * Path to the settings directory
 **/
export const SETTINGS_DIR = path.join(getJanDataFolderPath(), 'settings')
/**
 * Path to the settings file
 **/
export const GPU_INFO_FILE = path.join(SETTINGS_DIR, 'settings.json')

/**
 * Default GPU settings
 * TODO: This needs to be refactored to support multiple accelerators
 **/
const DEFAULT_SETTINGS: GpuSetting = {
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
  vulkan: false,
}

export const getGpuConfig = async (): Promise<GpuSetting | undefined> => {
  if (process.platform === 'darwin') return undefined
  if (existsSync(GPU_INFO_FILE))
    return JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
  return DEFAULT_SETTINGS
}

export const getResourcesInfo = async (): Promise<ResourceInfo> => {
  const ramUsedInfo = await mem.used()
  const totalMemory = ramUsedInfo.totalMemMb * 1024 * 1024
  const usedMemory = ramUsedInfo.usedMemMb * 1024 * 1024

  const resourceInfo: ResourceInfo = {
    mem: {
      totalMemory,
      usedMemory,
    },
  }

  return resourceInfo
}

export const getCurrentLoad = () =>
  new Promise<CpuGpuInfo>(async (resolve, reject) => {
    const cpuPercentage = await cpu.usage()
    let data = {
      run_mode: 'cpu',
      gpus_in_use: [],
    }

    if (process.platform !== 'darwin') {
      data = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
    }

    if (data.run_mode === 'gpu' && data.gpus_in_use.length > 0) {
      const gpuIds = data.gpus_in_use.join(',')
      if (gpuIds !== '' && data['vulkan'] !== true) {
        exec(
          `nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.total,memory.free,utilization.memory --format=csv,noheader,nounits --id=${gpuIds}`,
          (error, stdout, _) => {
            if (error) {
              console.error(`exec error: ${error}`)
              throw new Error(error.message)
            }
            const gpuInfo: GpuInfo[] = stdout
              .trim()
              .split('\n')
              .map((line) => {
                const [
                  id,
                  name,
                  temperature,
                  utilization,
                  memoryTotal,
                  memoryFree,
                  memoryUtilization,
                ] = line.split(', ').map((item) => item.replace(/\r/g, ''))
                return {
                  id,
                  name,
                  temperature,
                  utilization,
                  memoryTotal,
                  memoryFree,
                  memoryUtilization,
                }
              })

            resolve({
              cpu: { usage: cpuPercentage },
              gpu: gpuInfo,
            })
          }
        )
      } else {
        // Handle the case where gpuIds is empty
        resolve({
          cpu: { usage: cpuPercentage },
          gpu: [],
        })
      }
    } else {
      // Handle the case where run_mode is not 'gpu' or no GPUs are in use
      resolve({
        cpu: { usage: cpuPercentage },
        gpu: [],
      })
    }
  })

/**
 * This will retrieve GPU information and persist settings.json
 * Will be called when the extension is loaded to turn on GPU acceleration if supported
 */
export const updateNvidiaInfo = async () => {
  // ignore if macos
  if (process.platform === 'darwin') return

  try {
    JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
  } catch (error) {
    if (!existsSync(SETTINGS_DIR)) {
      mkdirSync(SETTINGS_DIR, {
        recursive: true,
      })
    }
    writeFileSync(GPU_INFO_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2))
  }

  await updateNvidiaDriverInfo()
  await updateGpuInfo()
}

const updateNvidiaDriverInfo = async () =>
  new Promise((resolve, reject) => {
    exec(
      'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
      (error, stdout) => {
        const data: GpuSetting = JSON.parse(
          readFileSync(GPU_INFO_FILE, 'utf-8')
        )

        if (!error) {
          const firstLine = stdout.split('\n')[0].trim()
          data.nvidia_driver.exist = true
          data.nvidia_driver.version = firstLine
        } else {
          data.nvidia_driver.exist = false
        }

        writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
        resolve({})
      }
    )
  })

const getGpuArch = (gpuName: string): string => {
  if (!gpuName.toLowerCase().includes('nvidia')) return 'unknown'

  if (gpuName.includes('30')) return 'ampere'
  else if (gpuName.includes('40')) return 'ada'
  else return 'unknown'
}

const updateGpuInfo = async () =>
  new Promise((resolve, reject) => {
    let data: GpuSetting = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))

    // Cuda
    if (data.vulkan === true) {
      // Vulkan
      exec(
        process.platform === 'win32'
          ? `${__dirname}\\..\\bin\\vulkaninfoSDK.exe --summary`
          : `${__dirname}/../bin/vulkaninfo --summary`,
        async (error, stdout) => {
          if (!error) {
            const output = stdout.toString()

            log(output)
            const gpuRegex = /GPU(\d+):(?:[\s\S]*?)deviceName\s*=\s*(.*)/g

            const gpus: GpuSettingInfo[] = []
            let match
            while ((match = gpuRegex.exec(output)) !== null) {
              const id = match[1]
              const name = match[2]
              const arch = getGpuArch(name)
              gpus.push({ id, vram: '0', name, arch })
            }
            data.gpus = gpus

            if (!data.gpus_in_use || data.gpus_in_use.length === 0) {
              data.gpus_in_use = [data.gpus.length > 1 ? '1' : '0']
            }

            data = await updateCudaExistence(data)
            writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
            log(`[APP]::${JSON.stringify(data)}`)
            resolve({})
          } else {
            reject(error)
          }
        }
      )
    } else {
      exec(
        'nvidia-smi --query-gpu=index,memory.total,name --format=csv,noheader,nounits',
        async (error, stdout) => {
          if (!error) {
            log(`[SPECS]::${stdout}`)
            // Get GPU info and gpu has higher memory first
            let highestVram = 0
            let highestVramId = '0'
            const gpus: GpuSettingInfo[] = stdout
              .trim()
              .split('\n')
              .map((line) => {
                let [id, vram, name] = line.split(', ')
                const arch = getGpuArch(name)
                vram = vram.replace(/\r/g, '')
                if (parseFloat(vram) > highestVram) {
                  highestVram = parseFloat(vram)
                  highestVramId = id
                }
                return { id, vram, name, arch }
              })

            data.gpus = gpus
            data.gpu_highest_vram = highestVramId
          } else {
            data.gpus = []
            data.gpu_highest_vram = undefined
          }

          if (!data.gpus_in_use || data.gpus_in_use.length === 0) {
            data.gpus_in_use = data.gpu_highest_vram ? [data.gpu_highest_vram].filter(e => !!e) : []
          }

          data = await updateCudaExistence(data)
          console.log('[MONITORING]::Cuda info: ', data)
          writeFileSync(GPU_INFO_FILE, JSON.stringify(data, null, 2))
          log(`[APP]::${JSON.stringify(data)}`)
          resolve({})
        }
      )
    }
  })

/**
 * Check if file exists in paths
 */
const checkFileExistenceInPaths = (file: string, paths: string[]): boolean => {
  return paths.some((p) => existsSync(path.join(p, file)))
}

/**
 * Validate cuda for linux and windows
 */
const updateCudaExistence = async (
  data: GpuSetting = DEFAULT_SETTINGS
): Promise<GpuSetting> => {
  let filesCuda12: string[]
  let filesCuda11: string[]
  let paths: string[]
  let cudaVersion: string = ''

  if (process.platform === 'win32') {
    filesCuda12 = ['cublas64_12.dll', 'cudart64_12.dll', 'cublasLt64_12.dll']
    filesCuda11 = ['cublas64_11.dll', 'cudart64_110.dll', 'cublasLt64_11.dll']
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

  data.cuda.exist = cudaExists
  data.cuda.version = cudaVersion

  console.debug(data.is_initial, data.gpus_in_use)

  if (cudaExists && data.is_initial && data.gpus_in_use.length > 0) {
    data.run_mode = 'gpu'
  }

  data.is_initial = false

  // Attempt to query CUDA using NVIDIA SMI
  if (!cudaExists) {
    await new Promise<void>((resolve) => {
      exec('nvidia-smi', (error, stdout) => {
        if (!error) {
          const regex = /CUDA\s*Version:\s*(\d+\.\d+)/g
          const match = regex.exec(stdout)
          if (match && match[1]) {
            data.cuda.version = match[1]
          }
        }
        console.log('[MONITORING]::Finalized cuda info update: ', data)
        resolve()
      })
    })
  }
  return data
}

export const getOsInfo = (): OperatingSystemInfo => {
  const platform =
    SupportedPlatforms.find((p) => p === process.platform) || 'unknown'

  const osInfo: OperatingSystemInfo = {
    platform: platform,
    arch: process.arch,
    release: os.release(),
    machine: os.machine(),
    version: os.version(),
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
  }

  return osInfo
}

export const registerLogger = ({ logEnabled, logCleaningInterval }) => {
  const logger = new FileLogger(logEnabled, logCleaningInterval)
  LoggerManager.instance().register(logger)
  logger.cleanLogs()
}

export const unregisterLogger = () => {
  LoggerManager.instance().unregister('file')
}

export const updateLogger = ({ logEnabled, logCleaningInterval }) => {
  const logger = LoggerManager.instance().loggers.get('file') as FileLogger
  if (logger && logEnabled !== undefined) logger.logEnabled = logEnabled
  if (logger && logCleaningInterval)
    logger.logCleaningInterval = logCleaningInterval
  // Rerun
  logger && logger.cleanLogs()
}
