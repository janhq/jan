import { GpuSetting, log } from '@janhq/core'

/**
 * The GPU runMode that will be set - either 'vulkan', 'cuda', or empty for cpu.
 * @param settings
 * @returns
 */

const gpuRunMode = (settings?: GpuSetting): string => {
  return settings.gpus?.some(
    (gpu) =>
      gpu.activated === true &&
      gpu.additional_information &&
      gpu.additional_information.driver_version
  )
    ? 'cuda'
    : ''
}

/**
 * The OS & architecture that the current process is running on.
 * @returns win, mac-x64, mac-arm64, or linux
 */
const os = (settings?: GpuSetting): string => {
  return PLATFORM === 'win32'
    ? 'windows-amd64'
    : PLATFORM === 'darwin'
    ? settings?.cpu?.arch === 'arm64'
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
export const engineVariant = async (
  gpuSetting?: GpuSetting
): Promise<string> => {
  const platform = os(gpuSetting)

  // There is no need to append the variant extension for mac
  if (platform.startsWith('mac')) return platform

  let engineVariant =
    gpuSetting?.vulkan || gpuSetting.gpus.some((e) => !e.additional_information)
      ? [platform, 'vulkan']
      : [
          platform,
          gpuRunMode(gpuSetting) === 'cuda' &&
          (gpuSetting.cpu.instructions.includes('avx2') ||
            gpuSetting.cpu.instructions.includes('avx512'))
            ? 'avx2'
            : 'noavx',
          gpuRunMode(gpuSetting),
          cudaVersion(gpuSetting),
        ].filter(Boolean) // Remove any falsy values

  let engineVariantString = engineVariant.join('-')

  log(`[CORTEX]: Engine variant: ${engineVariantString}`)
  return engineVariantString
}
