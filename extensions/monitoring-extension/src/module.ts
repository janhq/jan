const nodeOsUtils = require('node-os-utils')
const getJanDataFolderPath = require('@janhq/core/node').getJanDataFolderPath
const path = require('path')
const { readFileSync } = require('fs')
const exec = require('child_process').exec

const NVIDIA_INFO_FILE = path.join(
  getJanDataFolderPath(),
  'settings',
  'settings.json'
)

const getResourcesInfo = () =>
  new Promise((resolve) => {
    nodeOsUtils.mem.used().then((ramUsedInfo) => {
      const totalMemory = ramUsedInfo.totalMemMb * 1024 * 1024
      const usedMemory = ramUsedInfo.usedMemMb * 1024 * 1024
      const response = {
        mem: {
          totalMemory,
          usedMemory,
        },
      }
      resolve(response)
    })
  })

const getCurrentLoad = () =>
  new Promise((resolve, reject) => {
    nodeOsUtils.cpu.usage().then((cpuPercentage) => {
      let data = {
        run_mode: 'cpu',
        gpus_in_use: [],
      }
      if (process.platform !== 'darwin') {
        data = JSON.parse(readFileSync(NVIDIA_INFO_FILE, 'utf-8'))
      }
      if (data.run_mode === 'gpu' && data.gpus_in_use.length > 0) {
        const gpuIds = data['gpus_in_use'].join(',')
        if (gpuIds !== '' && data['vulkan'] !== true) {
          exec(
            `nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.total,memory.free,utilization.memory --format=csv,noheader,nounits --id=${gpuIds}`,
            (error, stdout, _) => {
              if (error) {
                console.error(`exec error: ${error}`)
                reject(error)
                return
              }
              const gpuInfo = stdout
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
          resolve({ cpu: { usage: cpuPercentage }, gpu: [] })
        }
      } else {
        // Handle the case where run_mode is not 'gpu' or no GPUs are in use
        resolve({ cpu: { usage: cpuPercentage }, gpu: [] })
      }
    })
  })

module.exports = {
  getResourcesInfo,
  getCurrentLoad,
}
