import { GpuSetting } from '@janhq/core'
import * as path from 'path'
import { cpuInfo } from 'cpu-instructions'

export interface CortexExecutableOptions {
  enginePath: string
  binPath: string
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

  return settings.vulkan === true
    ? 'vulkan'
    : settings.run_mode === 'cpu'
      ? ''
      : 'cuda'
}

/**
 * The OS & architecture that the current process is running on.
 * @returns win, mac-x64, mac-arm64, or linux
 */
const os = (): string => {
  return process.platform === 'win32'
    ? 'win'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'arm64'
        : 'x64'
      : 'linux'
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
    settings?.vulkan !== true && settings?.run_mode === 'gpu' && os() !== 'mac'

  if (!isUsingCuda) return undefined
  return settings?.cuda?.version === '11' ? '11-7' : '12-0'
}

/**
 * The CPU instructions that will be set - either 'avx512', 'avx2', 'avx', or 'noavx'.
 * @returns
 */
const cpuInstructions = (): string => {
  if (process.platform === 'darwin') return ''
  return cpuInfo.cpuInfo().some((e) => e.toUpperCase() === 'AVX512')
    ? 'avx512'
    : cpuInfo.cpuInfo().some((e) => e.toUpperCase() === 'AVX2')
      ? 'avx2'
      : cpuInfo.cpuInfo().some((e) => e.toUpperCase() === 'AVX')
        ? 'avx'
        : 'noavx'
}

/**
 * Find which executable file to run based on the current platform.
 * @returns The name of the executable file to run.
 */
export const executableCortexFile = (
  gpuSetting?: GpuSetting
): CortexExecutableOptions => {
  const cpuInstruction = cpuInstructions()
  let engineFolder = gpuSetting?.vulkan
    ? 'vulkan'
    : process.platform === 'darwin'
      ? os()
      : [
          gpuRunMode(gpuSetting) !== 'cuda' ||
          cpuInstruction === 'avx' ||
          cpuInstruction === 'noavx'
            ? cpuInstruction
            : '',
          gpuRunMode(gpuSetting),
          cudaVersion(gpuSetting),
        ]
          .filter((e) => !!e)
          .join('-')
  let cudaVisibleDevices = gpuSetting?.gpus_in_use.join(',') ?? ''
  let vkVisibleDevices = gpuSetting?.gpus_in_use.join(',') ?? ''
  let binaryName = `cortex-server${extension()}`
  const binPath = path.join(__dirname, '..', 'bin')
  return {
    enginePath: path.join(binPath, engineFolder),
    executablePath: path.join(binPath, binaryName),
    binPath: binPath,
    cudaVisibleDevices,
    vkVisibleDevices,
  }
}
