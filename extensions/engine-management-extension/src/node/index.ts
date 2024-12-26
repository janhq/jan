import * as path from 'path'
import {
  appResourcePath,
  getJanDataFolderPath,
  GpuSetting,
  log,
} from '@janhq/core/node'
import { fork } from 'child_process'
import { mkdir, readdir, symlink } from 'fs/promises'

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
 * Find which variant to run based on the current platform.
 */
const engineVariant = async (gpuSetting?: GpuSetting): Promise<string> => {
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

/**
 * Create symlink to each variant for the default bundled version
 */
const symlinkEngines = async () => {
  const sourceEnginePath = path.join(
    appResourcePath(),
    'shared',
    'engines',
    'cortex.llamacpp'
  )
  const symlinkEnginePath = path.join(
    getJanDataFolderPath(),
    'engines',
    'cortex.llamacpp'
  )
  const variantFolders = await readdir(sourceEnginePath)
  for (const variant of variantFolders) {
    const targetVariantPath = path.join(
      sourceEnginePath,
      variant,
      CORTEX_ENGINE_VERSION
    )
    const symlinkVariantPath = path.join(
      symlinkEnginePath,
      variant,
      CORTEX_ENGINE_VERSION
    )

    await mkdir(path.join(sourceEnginePath, variant), {
      recursive: true,
    }).catch(console.error)

    await symlink(targetVariantPath, symlinkVariantPath).catch(console.error)
    console.log(`Symlink created: ${targetVariantPath} -> ${symlinkEnginePath}`)
  }
}

export default {
  engineVariant,
  symlinkEngines,
}
