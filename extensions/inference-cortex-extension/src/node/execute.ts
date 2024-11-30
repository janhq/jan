import * as path from 'path'
import { GpuSetting, appResourcePath, log } from '@janhq/core/node'
import { fork } from 'child_process'

export interface CortexExecutableOptions {
  enginePath: string
  executablePath: string
  cudaVisibleDevices: string
  vkVisibleDevices: string
}
/**
 * The GPU runMode that will be set - either 'vulkan', 'cuda', or empty for cpu.
 * @param settings
 * @returns
 */
const gpuRunMode = (settings?: GpuSetting): string => {
  if (process.platform === 'darwin')
    // MacOS now has universal binaries
    return ''

  if (!settings) return ''

  return settings.vulkan === true || settings.run_mode === 'cpu' ? '' : 'cuda'
}

/**
 * The OS & architecture that the current process is running on.
 * @returns win, mac-x64, mac-arm64, or linux
 */
const os = (): string => {
  return process.platform === 'win32'
    ? 'windows-amd64'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'mac-arm64'
        : 'mac-amd64'
      : 'linux-amd64'
}

/**
 * The cortex.cpp extension based on the current platform.
 * @returns .exe if on Windows, otherwise an empty string.
 */
const extension = (): '.exe' | '' => {
  return process.platform === 'win32' ? '.exe' : ''
}

/**
 * The CUDA version that will be set - either '11-7' or '12-0'.
 * @param settings
 * @returns
 */
const cudaVersion = (settings?: GpuSetting): '11-7' | '12-0' | undefined => {
  const isUsingCuda =
    settings?.vulkan !== true &&
    settings?.run_mode === 'gpu' &&
    !os().includes('mac')

  if (!isUsingCuda) return undefined
  return settings?.cuda?.version === '11' ? '11-7' : '12-0'
}

/**
 * The CPU instructions that will be set - either 'avx512', 'avx2', 'avx', or 'noavx'.
 * @returns
 */
const cpuInstructions = async (): Promise<string> => {
  if (process.platform === 'darwin') return ''

  const child = fork(path.join(__dirname, './cpuInfo.js')) // Path to the child process file

  return new Promise((resolve, reject) => {
    child.on('message', (cpuInfo?: string) => {
      resolve(cpuInfo ?? 'noavx')
      child.kill() // Kill the child process after receiving the result
    })

    child.on('error', (err) => {
      resolve('noavx')
      child.kill()
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        resolve('noavx')
        child.kill()
      }
    })
  })
}

/**
 * The executable options for the cortex.cpp extension.
 */
export const executableCortexFile = (
  gpuSetting?: GpuSetting
): CortexExecutableOptions => {
  let cudaVisibleDevices = gpuSetting?.gpus_in_use.join(',') ?? ''
  let vkVisibleDevices = gpuSetting?.gpus_in_use.join(',') ?? ''
  let binaryName = `cortex-server${extension()}`
  const binPath = path.join(__dirname, '..', 'bin')
  return {
    enginePath: path.join(appResourcePath(), 'shared'),
    executablePath: path.join(binPath, binaryName),
    cudaVisibleDevices,
    vkVisibleDevices,
  }
}

/**
 * Find which variant to run based on the current platform.
 */
export const engineVariant = async (
  gpuSetting?: GpuSetting
): Promise<string> => {
  const cpuInstruction = await cpuInstructions()
  log(`[CORTEX]: CPU instruction: ${cpuInstruction}`)
  let engineVariant = [
    os(),
    gpuSetting?.vulkan
      ? 'vulkan'
      : gpuRunMode(gpuSetting) !== 'cuda'
        ? // CPU mode - support all variants
          cpuInstruction
        : // GPU mode - packaged CUDA variants of avx2 and noavx
          cpuInstruction === 'avx2' || cpuInstruction === 'avx512'
          ? 'avx2'
          : 'noavx',
    gpuRunMode(gpuSetting),
    cudaVersion(gpuSetting),
  ]
    .filter((e) => !!e)
    .join('-')

  log(`[CORTEX]: Engine variant: ${engineVariant}`)
  return engineVariant
}
