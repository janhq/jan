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
export async function listSupportedBackends(): Promise<{ version: string, backend: string }[]> {
  const sysInfo = await window.core.api.getSystemInfo()
  const os_type = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  const sysType = `${os_type}-${arch}`
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
  if (sysType == 'windows-x86_64') {
    // NOTE: if a machine supports AVX2, should we include noavx and avx?
    backends.push('win-noavx-x64')
    if (supportsAvx) backends.push('win-avx-x64')
    if (supportsAvx2) backends.push('win-avx2-x64')
    if (supportsAvx512) backends.push('win-avx512-x64')
    if (supportsCuda) backends.push('win-avx2-cuda-cu11.7-x64', 'win-avx2-cuda-cu12.0-x64')
    if (supportsVulkan) backends.push('win-vulkan-x64')
  }
  else if (sysType == 'linux-x86_64') {
    backends.push('linux-noavx-x64')
    if (supportsAvx) backends.push('linux-avx-x64')
    if (supportsAvx2) backends.push('linux-avx2-x64')
    if (supportsAvx512) backends.push('linux-avx512-x64')
    if (supportsCuda) backends.push('linux-avx2-cuda-cu11.7-x64', 'linux-avx2-cuda-cu12.0-x64')
    if (supportsVulkan) backends.push('linux-vulkan-x64')
  }
  else if (sysType === 'macos-x86_64') {
    backends.push('macos-x64')
  }
  else if (sysType === 'macos-aarch64') {
    backends.push('macos-arm64')
  }

  const releases = await _fetchGithubReleases('menloresearch', 'llama.cpp')
  releases.sort((a, b) => b.tag_name.localeCompare(a.tag_name))
  releases.splice(10) // keep only the latest 10 releases

  let backendVersions = []
  for (const release of releases) {
    const version = release.tag_name
    const prefix = `llama-${version}-bin-`

    // NOTE: there is checksum.yml. we can also download it to verify the download
    for (const asset of release.assets) {
      const name = asset.name
      if (!name.startsWith(prefix)) {
        continue
      }

      const backend = name.replace(prefix, '').replace('.tar.gz', '')
      if (backends.includes(backend)) {
        backendVersions.push({ version, backend })
      }
    }
  }

  return backendVersions
}

export async function isBackendInstalled(backend: string, version: string): Promise<boolean> {
  const sysInfo = await window.core.api.getSystemInfo()
  const exe_name = sysInfo.os_type === 'windows' ? 'llama-server.exe' : 'llama-server'

  const janDataFolderPath = await getJanDataFolderPath()
  const backendPath = await joinPath([janDataFolderPath, 'llamacpp', 'backends', backend, version, 'build', 'bin', exe_name])
  const result = await fs.existsSync(backendPath)
  return result
}

export async function downloadBackend(backend: string, version: string): Promise<void> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendPath = await joinPath([janDataFolderPath, 'llamacpp', 'backends', backend, version])

  const downloadManager = window.core.extensionManager.getByName('@janhq/download-extension')
  const url = `https://github.com/menloresearch/llama.cpp/releases/download/${version}/llama-${version}-bin-${backend}.tar.gz`
  const savePath = await joinPath([backendPath, 'backend.tar.gz'])
  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')
  const downloadType = 'Engine'

  console.log(`Downloading backend ${backend} version ${version} from ${url} to ${savePath}`)
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

async function _fetchGithubReleases(
  owner: string,
  repo: string,
): Promise<any[]> {
  // by default, it's per_page=30 and page=1 -> the latest 30 releases
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch releases from ${url}: ${response.statusText}`)
  }
  return response.json()
}
