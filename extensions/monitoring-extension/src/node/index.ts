import { ResourceInfo } from '@janhq/core'
import { getJanDataFolderPath, log } from '@janhq/core/node'
import { readFileSync } from 'fs'
import { mem, cpu } from 'node-os-utils'
import path from 'path'
import { exec } from 'child_process'

/**
 * Path to the settings file
 **/
export const GPU_INFO_FILE = path.join(
  getJanDataFolderPath(),
  'settings',
  'settings.json'
)

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

export const getCurrentLoad = async (): Promise<CpuGpuInfo> => {
  const cpuPercentage = await cpu.usage()
  let data = {
    run_mode: 'cpu',
    gpus_in_use: [],
  }

  if (process.platform !== 'darwin') {
    data = JSON.parse(readFileSync(GPU_INFO_FILE, 'utf-8'))
  }

  if (data.run_mode === 'gpu' && data.gpus_in_use.length > 0) {
    const gpuIds = data['gpus_in_use'].join(',')
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

          return {
            cpu: { usage: cpuPercentage },
            gpu: gpuInfo,
          }
        }
      )
    } else {
      // Handle the case where gpuIds is empty
      return {
        cpu: { usage: cpuPercentage },
        gpu: [],
      }
    }
  } else {
    // Handle the case where run_mode is not 'gpu' or no GPUs are in use
    return {
      cpu: { usage: cpuPercentage },
      gpu: [],
    }
  }
}
