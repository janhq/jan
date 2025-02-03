
import {
  GpuSetting,
  log,
} from '@janhq/core'

/**
 * The GPU runMode that will be set - either 'vulkan', 'cuda', or empty for cpu.
 * @param settings
 * @returns
 */

 const gpuRunMode = (settings?: GpuSetting): string => {

  if (!settings) return ''

  return settings.vulkan === true ||
    settings.gpus?.some((gpu) => gpu.activated !== true)
    ? ''
    : 'cuda'
}

/**
 * The OS & architecture that the current process is running on.
 * @returns win, mac-x64, mac-arm64, or linux
 */
const os = (settings?: GpuSetting): string => {
  return PLATFORM === 'win32'
    ? 'windows-amd64'
    : PLATFORM === 'darwin'
    ? settings?.cpu?.arc === 'arm64'
      ? 'mac-arm64'
      : 'mac-amd64'
    : 'linux-amd64'
}

/**
 * The CUDA version that will be set - either '11-7' or '12-0'.
 * @param settings
 * @returns
 */
const cudaVersion = (settings?: GpuSetting): '12-0' | '11-7' | undefined => {
  const isUsingCuda =
    settings?.vulkan !== true &&
    settings?.gpus?.some((gpu) => (gpu.activated === true ? 'gpu' : 'cpu')) &&
    !os().includes('mac')

  if (!isUsingCuda) return undefined
  // return settings?.cuda?.version === '11' ? '11-7' : '12-0'
  return settings.gpus?.some((gpu) => gpu.version.includes('12'))
    ? '12-0'
    : '11-7'
}

/**
 * The CPU instructions that will be set - either 'avx512', 'avx2', 'avx', or 'noavx'.
 * @returns
 */

/**
 * Find which variant to run based on the current platform.
 */
export const engineVariant = async (gpuSetting?: GpuSetting): Promise<string> => {
  let engineVariant = [
    os(gpuSetting),
    gpuSetting?.vulkan
      ? 'vulkan'
      : (gpuRunMode(gpuSetting) === 'cuda' && // GPU mode - packaged CUDA variants of avx2 and noavx
          gpuSetting.cpu.instructions.some((inst) => inst === 'avx2')) ||
        gpuSetting.cpu.instructions.some((inst) => inst === 'avx512')
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
