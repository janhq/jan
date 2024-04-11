import { GpuSetting, SystemInformation } from '@janhq/core'
import * as path from 'path'

export interface NitroExecutableOptions {
  executablePath: string
  cudaVisibleDevices: string
  vkVisibleDevices: string
}
const runMode = (settings?: GpuSetting): string => {
  if (process.platform === 'darwin')
    // MacOS now has universal binaries
    return ''

  if (!settings) return 'cpu'

  return settings.vulkan === true
    ? 'vulkan'
    : settings.run_mode === 'cpu'
      ? 'cpu'
      : 'cuda'
}

const os = (): string => {
  return process.platform === 'win32'
    ? 'win'
    : process.platform === 'darwin'
      ? 'mac-universal'
      : 'linux'
}

const extension = (): '.exe' | '' => {
  return process.platform === 'win32' ? '.exe' : ''
}

const cudaVersion = (settings?: GpuSetting): '11-7' | '12-0' | undefined => {
  const isUsingCuda =
    settings?.vulkan !== true && settings?.run_mode === 'gpu' && os() !== 'mac'

  if (!isUsingCuda) return undefined
  return settings?.cuda?.version === '11' ? '11-7' : '12-0'
}

/**
 * Find which executable file to run based on the current platform.
 * @returns The name of the executable file to run.
 */
export const executableNitroFile = (
  gpuSetting?: GpuSetting
): NitroExecutableOptions => {
  let binaryFolder = [os(), runMode(gpuSetting), cudaVersion(gpuSetting)]
    .filter((e) => !!e)
    .join('-')
  let cudaVisibleDevices = gpuSetting?.gpus_in_use.join(',') ?? ''
  let vkVisibleDevices = gpuSetting?.gpus_in_use.join(',') ?? ''
  let binaryName = `nitro${extension()}`

  return {
    executablePath: path.join(__dirname, '..', 'bin', binaryFolder, binaryName),
    cudaVisibleDevices,
    vkVisibleDevices,
  }
}
