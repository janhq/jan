import { GpuSetting, log } from '@janhq/core'

// Supported run modes
enum RunMode {
  Cuda = 'cuda',
  CPU = 'cpu',
}

// Supported instruction sets
const instructionBinaryNames = ['noavx', 'avx', 'avx2', 'avx512']

/**
 * The GPU runMode that will be set - either 'vulkan', 'cuda', or empty for cpu.
 * @param settings
 * @returns
 */

const gpuRunMode = (settings?: GpuSetting): RunMode => {
  return settings.gpus?.some(
    (gpu) =>
      gpu.activated &&
      gpu.additional_information &&
      gpu.additional_information.driver_version
  )
    ? RunMode.Cuda
    : RunMode.CPU
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

  const runMode = gpuRunMode(gpuSetting)
  // Only Nvidia GPUs have addition_information set and activated by default
  let engineVariant =
    !gpuSetting?.vulkan ||
    !gpuSetting.gpus?.length ||
    gpuSetting.gpus.some((e) => e.additional_information && e.activated)
      ? [
          platform,
          ...(runMode === RunMode.Cuda
            ? // For cuda we only need to check if the cpu supports avx2 or noavx - since other binaries are not shipped with the extension
              [
                gpuSetting.cpu?.instructions.includes('avx2') ||
                gpuSetting.cpu?.instructions.includes('avx512')
                  ? 'avx2'
                  : 'noavx',
                runMode,
                cudaVersion(gpuSetting),
              ]
            : // For cpu only we need to check all available supported instructions
              [
                (gpuSetting.cpu?.instructions ?? ['noavx']).find((e) =>
                  instructionBinaryNames.includes(e.toLowerCase())
                ) ?? 'noavx',
              ]),
        ].filter(Boolean)
      : [platform, 'vulkan']

  let engineVariantString = engineVariant.join('-')

  log(`[CORTEX]: Engine variant: ${engineVariantString}`)
  return engineVariantString
}
