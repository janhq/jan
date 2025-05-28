import {
  getJanDataFolderPath,
  fs,
  joinPath,
  events,
} from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'

// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_name>/<backend_version>

// what should be available to the user for selection?
export async function listSupportedBackends(): Promise<string[]> {
  const sysInfo = await window.core.api.getSystemInfo()
  const os_type = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  const key = `${os_type}-${arch}`
  let backends = []

  let supportsAvx = 'avx' in sysInfo.cpu.extensions
  let supportsAvx2 = 'avx2' in sysInfo.cpu.extensions
  let supportsAvx512 = 'avx512_f' in sysInfo.cpu.extensions

  // TODO: HIP and SYCL
  let supportsCuda = false
  let supportsVulkan = false
  for (const gpuInfo of sysInfo.gpus) {
    if (gpuInfo.nvidiaInfo?.compute_capability) {
      supportsCuda = true
    }
    if (gpuInfo.vulkanInfo?.api_version) {
      supportsVulkan = true
    }
  }

  // NOTE: menloresearch's tags for llama.cpp builds are a bit different
  // TODO: fetch versions from the server?
  // TODO: select CUDA version based on driver version
  // https://docs.nvidia.com/deploy/cuda-compatibility/#cuda-11-and-later-defaults-to-minor-version-compatibility
  if (key == 'windows-x86_64') {
    // NOTE: if a machine supports AVX2, should we include noavx and avx?
    backends.push('win-noavx-x64')
    if (supportsAvx) backends.push('win-avx-x64')
    if (supportsAvx2) backends.push('win-avx2-x64')
    if (supportsAvx512) backends.push('win-avx512-x64')
    if (supportsCuda) backends.push('win-avx2-cuda-cu11.7-x64', 'win-avx2-cuda-cu12.0-x64')
    if (supportsVulkan) backends.push('win-vulkan-x64')
  }
  else if (key == 'linux-x86_64') {
    backends.push('linux-noavx-x64')
    if (supportsAvx) backends.push('linux-avx-x64')
    if (supportsAvx2) backends.push('linux-avx2-x64')
    if (supportsAvx512) backends.push('linux-avx512-x64')
    if (supportsCuda) backends.push('linux-avx2-cuda-cu11.7-x64', 'linux-avx2-cuda-cu12.0-x64')
    if (supportsVulkan) backends.push('linux-vulkan-x64')
  }
  else if (key === 'macos-x86_64') {
    backends.push('macos-x64')
  }
  else if (key === 'macos-aarch64') {
    backends.push('macos-arm64')
  }

  return backends
}

export async function isBackendInstalled(backend: string): Promise<boolean> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendPath = await joinPath([janDataFolderPath, 'llamacpp', 'backends', backend])
  return await fs.existsSync(backendPath)
}

export async function downloadBackend(backend: string, version: string): Promise<void> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendPath = await joinPath([janDataFolderPath, 'llamacpp', 'backends', backend, version])

  const downloadManager = window.core.extensionManager.getByName('@janhq/download-extension')
  const url = `https://github.com/menloresearch/llama.cpp/releases/download/${version}/llama-${version}-bin-${backend}.tar.gz`
  const savePath = await joinPath([backendPath, 'backend.tar.gz'])
  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')
  const downloadType = 'Engine'

  let downloadCompleted = false
  try {
    await downloadManager.downloadFile(
      url,
      savePath,
      taskId,
      (transferred: number, total: number) => {
        events.emit('onFileDownloadUpdate', {
          modelId: taskId,
          percent: transferred / total,
          size: { transferred, total },
          downloadType,
        })
        downloadCompleted = transferred === total
      }
    )

    // once we reach this point, it either means download finishes or it was cancelled.
    // if there was an error, it would have been caught above
    if (!downloadCompleted) {
      events.emit('onFileDownloadStopped', { modelId: taskId, downloadType })
      return
    }

    await invoke('decompress', { path: savePath, outputDir: backendPath })
    await fs.rm(savePath)

    events.emit('onFileDownloadSuccess', { modelId: taskId, downloadType })
  } catch (error) {
    console.error(`Failed to download backend ${backend}:`, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}
