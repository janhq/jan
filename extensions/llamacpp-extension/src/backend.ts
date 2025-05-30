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

  const features = await _getSupportedFeatures()
  const sysType = `${os_type}-${arch}`
  let backends = []

  // NOTE: menloresearch's tags for llama.cpp builds are a bit different
  // TODO: fetch versions from the server?
  // TODO: select CUDA version based on driver version
  if (sysType == 'windows-x86_64') {
    // NOTE: if a machine supports AVX2, should we include noavx and avx?
    backends.push('win-noavx-x64')
    if (features.avx) backends.push('win-avx-x64')
    if (features.avx2) backends.push('win-avx2-x64')
    if (features.avx512) backends.push('win-avx512-x64')
    if (features.cuda11) backends.push('win-avx2-cuda-cu11.7-x64')
    if (features.cuda12) backends.push('win-avx2-cuda-cu12.0-x64')
    if (features.vulkan) backends.push('win-vulkan-x64')
  }
  else if (sysType == 'linux-x86_64') {
    backends.push('linux-noavx-x64')
    if (features.avx) backends.push('linux-avx-x64')
    if (features.avx2) backends.push('linux-avx2-x64')
    if (features.avx512) backends.push('linux-avx512-x64')
    if (features.cuda11) backends.push('linux-avx2-cuda-cu11.7-x64')
    if (features.cuda12) backends.push('linux-avx2-cuda-cu12.0-x64')
    if (features.vulkan) backends.push('linux-vulkan-x64')
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
  const llamacppPath = await joinPath([janDataFolderPath, 'llamacpp'])

  const downloadManager = window.core.extensionManager.getByName('@janhq/download-extension')

  const downloadItems = [
    {
      url: `https://github.com/menloresearch/llama.cpp/releases/download/${version}/llama-${version}-bin-${backend}.tar.gz`,
      save_path: await joinPath([llamacppPath, 'backends', backend, version, 'backend.tar.gz']),
    }
  ]

  // also download CUDA runtime + cuBLAS + cuBLASLt if needed
  if (backend.includes('cu11.7') && (await _isCudaInstalled('11.7'))) {
    downloadItems.push({
      url: `https://github.com/menloresearch/llama.cpp/releases/download/${version}/cudart-llama-bin-linux-cu11.7-x64.tar.gz`,
      save_path: await joinPath([llamacppPath, 'lib', 'cuda.tar.gz']),
    })
  } else if (backend.includes('cu12.0') && (await _isCudaInstalled('12.0'))) {
    downloadItems.push({
      url: `https://github.com/menloresearch/llama.cpp/releases/download/${version}/cudart-llama-bin-linux-cu12.0-x64.tar.gz`,
      save_path: await joinPath([llamacppPath, 'lib', 'cuda.tar.gz']),
    })
  }

  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')
  const downloadType = 'Engine'

  console.log(`Downloading backend ${backend} version ${version}: ${downloadItems}`)
  let downloadCompleted = false
  try {
    const onProgress = (transferred: number, total: number) => {
      events.emit('onFileDownloadUpdate', {
        modelId: taskId,
        percent: transferred / total,
        size: { transferred, total },
        downloadType,
      })
      downloadCompleted = transferred === total
    }
    await downloadManager.downloadFiles(downloadItems, taskId, onProgress)

    // once we reach this point, it either means download finishes or it was cancelled.
    // if there was an error, it would have been caught above
    if (!downloadCompleted) {
      events.emit('onFileDownloadStopped', { modelId: taskId, downloadType })
      return
    }

    // decompress the downloaded tar.gz files
    for (const { save_path } of downloadItems) {
      if (save_path.endsWith('.tar.gz')) {
        const parentDir = save_path.substring(0, save_path.lastIndexOf('/'))
        await invoke('decompress', { path: save_path, outputDir: parentDir })
        await fs.rm(save_path)
      }
    }

    events.emit('onFileDownloadSuccess', { modelId: taskId, downloadType })
  } catch (error) {
    console.error(`Failed to download backend ${backend}: `, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}

async function _getSupportedFeatures() {
  const sysInfo = await window.core.api.getSystemInfo()
  const features = {
    avx: sysInfo.cpu.extensions.includes('avx'),
    avx2: sysInfo.cpu.extensions.includes('avx2'),
    avx512: sysInfo.cpu.extensions.includes('avx512'),
    cuda11: false,
    cuda12: false,
    vulkan: false,
  }

  // https://docs.nvidia.com/deploy/cuda-compatibility/#cuda-11-and-later-defaults-to-minor-version-compatibility
  let minCuda11DriverVersion
  let minCuda12DriverVersion
  if (sysInfo.os_type === 'linux') {
    minCuda11DriverVersion = '450.80.02'
    minCuda12DriverVersion = '525.60.13'
  } else if (sysInfo.os_type === 'windows') {
    minCuda11DriverVersion = '452.39'
    minCuda12DriverVersion = '527.41'
  }

  // TODO: HIP and SYCL
  for (const gpuInfo of sysInfo.gpus) {
    const driverVersion = gpuInfo.driver_version

    if (gpuInfo.nvidia_info?.compute_capability) {
      if (compareVersions(driverVersion, minCuda11DriverVersion) >= 0)
        features.cuda11 = true
      if (compareVersions(driverVersion, minCuda12DriverVersion) >= 0)
        features.cuda12 = true
    }

    if (gpuInfo.vulkan_info?.api_version) features.vulkan = true
  }

  return features
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

async function _isCudaInstalled(version: string): Promise<boolean> {
  const sysInfo = await window.core.api.getSystemInfo()
  const os_type = sysInfo.os_type

  // not sure the reason behind this naming convention
  const libnameLookup = {
    'windows-11.7': `cudart64_110.dll`,
    'windows-12.0': `cudart64_12.dll`,
    'linux-11.7': `libcudart.so.11.0`,
    'linux-12.0': `libcudart.so.12`,
  }
  const key = `${os_type}-${version}`
  if (!(key in libnameLookup)) {
    return false
  }

  const libname = libnameLookup[key]
  const janDataFolderPath = await getJanDataFolderPath()
  const cudartPath = await joinPath([janDataFolderPath, 'llamacpp', 'lib', libname])
  return await fs.existsSync(cudartPath)
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const x = aParts[i] || 0;
    const y = bParts[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
