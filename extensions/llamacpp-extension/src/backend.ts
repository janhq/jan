import { getJanDataFolderPath, fs, joinPath, events } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { getProxyConfig } from './util'
import { dirname, basename } from '@tauri-apps/api/path'
import { getSystemInfo } from '@janhq/tauri-plugin-hardware-api'

/*
 * Reads currently installed backends in janDataFolderPath
 *
 */
export async function getLocalInstalledBackends(): Promise<
  { version: string; backend: string }[]
> {
  const local: Array<{ version: string; backend: string }> = []
  const janDataFolderPath = await getJanDataFolderPath()
  const backendsDir = await joinPath([
    janDataFolderPath,
    'llamacpp',
    'backends',
  ])
  if (await fs.existsSync(backendsDir)) {
    const versionDirs = await fs.readdirSync(backendsDir)

    // If the folder does not exist we are done.
    if (!versionDirs) {
      return local
    }
    for (const version of versionDirs) {
      const versionPath = await joinPath([backendsDir, version])
      const versionName = await basename(versionPath)

      // Check if versionPath is actually a directory before reading it
      const versionStat = await fs.fileStat(versionPath)
      if (!versionStat?.isDirectory) {
        continue
      }

      const backendTypes = await fs.readdirSync(versionPath)

      // Verify that the backend is really installed
      for (const backendType of backendTypes) {
        const backendName = await basename(backendType)
        if (await isBackendInstalled(backendType, versionName)) {
          local.push({ version: versionName, backend: backendName })
        }
      }
    }
  }
  console.debug(local)
  return local
}

/*
 * currently reads available backends in remote
 *
 */
async function fetchRemoteSupportedBackends(
  supportedBackends: string[]
): Promise<{ version: string; backend: string }[]> {
  // Pull the latest releases from the repo
  const { releases } = await _fetchGithubReleases('menloresearch', 'llama.cpp')
  releases.sort((a, b) => b.tag_name.localeCompare(a.tag_name))
  releases.splice(10) // keep only the latest 10 releases

  // Walk the assets and keep only those that match a supported backend
  const remote: { version: string; backend: string }[] = []

  for (const release of releases) {
    const version = release.tag_name
    const prefix = `llama-${version}-bin-`

    for (const asset of release.assets) {
      const name = asset.name

      if (!name.startsWith(prefix)) continue

      const backend = name
        .replace(prefix, '')
        .replace('.tar.gz', '')
        .replace('.zip', '')

      if (supportedBackends.includes(backend)) {
        remote.push({ version, backend })
      }
    }
  }

  return remote
}

// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_version>/<backend_type>

// what should be available to the user for selection?
export async function listSupportedBackends(): Promise<
  { version: string; backend: string }[]
> {
  const sysInfo = await getSystemInfo()
  const os_type = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  const features = await _getSupportedFeatures()
  const sysType = `${os_type}-${arch}`
  let supportedBackends = []

  // NOTE: menloresearch's tags for llama.cpp builds are a bit different
  // TODO: fetch versions from the server?
  // TODO: select CUDA version based on driver version
  if (sysType == 'windows-x86_64') {
    // NOTE: if a machine supports AVX2, should we include noavx and avx?
    supportedBackends.push('win-noavx-x64')
    if (features.avx) supportedBackends.push('win-avx-x64')
    if (features.avx2) supportedBackends.push('win-avx2-x64')
    if (features.avx512) supportedBackends.push('win-avx512-x64')
    if (features.cuda11) {
      if (features.avx512) supportedBackends.push('win-avx512-cuda-cu11.7-x64')
      else if (features.avx2) supportedBackends.push('win-avx2-cuda-cu11.7-x64')
      else if (features.avx) supportedBackends.push('win-avx-cuda-cu11.7-x64')
      else supportedBackends.push('win-noavx-cuda-cu11.7-x64')
    }
    if (features.cuda12) {
      if (features.avx512) supportedBackends.push('win-avx512-cuda-cu12.0-x64')
      else if (features.avx2) supportedBackends.push('win-avx2-cuda-cu12.0-x64')
      else if (features.avx) supportedBackends.push('win-avx-cuda-cu12.0-x64')
      else supportedBackends.push('win-noavx-cuda-cu12.0-x64')
    }
    if (features.vulkan) supportedBackends.push('win-vulkan-x64')
  }
  // not available yet, placeholder for future
  else if (sysType === 'windows-aarch64' || sysType === 'windows-arm64') {
    supportedBackends.push('win-arm64')
  } else if (sysType === 'linux-x86_64' || sysType === 'linux-x86') {
    supportedBackends.push('linux-noavx-x64')
    if (features.avx) supportedBackends.push('linux-avx-x64')
    if (features.avx2) supportedBackends.push('linux-avx2-x64')
    if (features.avx512) supportedBackends.push('linux-avx512-x64')
    if (features.cuda11) {
      if (features.avx512)
        supportedBackends.push('linux-avx512-cuda-cu11.7-x64')
      else if (features.avx2)
        supportedBackends.push('linux-avx2-cuda-cu11.7-x64')
      else if (features.avx) supportedBackends.push('linux-avx-cuda-cu11.7-x64')
      else supportedBackends.push('linux-noavx-cuda-cu11.7-x64')
    }
    if (features.cuda12) {
      if (features.avx512)
        supportedBackends.push('linux-avx512-cuda-cu12.0-x64')
      else if (features.avx2)
        supportedBackends.push('linux-avx2-cuda-cu12.0-x64')
      else if (features.avx) supportedBackends.push('linux-avx-cuda-cu12.0-x64')
      else supportedBackends.push('linux-noavx-cuda-cu12.0-x64')
    }
    if (features.vulkan) supportedBackends.push('linux-vulkan-x64')
  }
  // not available yet, placeholder for future
  else if (sysType === 'linux-aarch64' || sysType === 'linux-arm64') {
    supportedBackends.push('linux-arm64')
  } else if (sysType === 'macos-x86_64' || sysType === 'macos-x86') {
    supportedBackends.push('macos-x64')
  } else if (sysType === 'macos-aarch64' || sysType === 'macos-arm64') {
    supportedBackends.push('macos-arm64')
  }
  // get latest backends from Github
  const remoteBackendVersions =
    await fetchRemoteSupportedBackends(supportedBackends)

  // Get locally installed versions
  const localBackendVersions = await getLocalInstalledBackends()
  // Use a Map keyed by “${version}|${backend}” for O(1) deduplication.
  const mergedMap = new Map<string, { version: string; backend: string }>()
  for (const entry of remoteBackendVersions) {
    mergedMap.set(`${entry.version}|${entry.backend}`, entry)
  }
  for (const entry of localBackendVersions) {
    mergedMap.set(`${entry.version}|${entry.backend}`, entry)
  }

  const merged = Array.from(mergedMap.values())
  // Sort newest version first; if versions tie, sort by backend name
  merged.sort((a, b) => {
    const versionCmp = b.version.localeCompare(a.version)
    return versionCmp !== 0 ? versionCmp : a.backend.localeCompare(b.backend)
  })

  return merged
}

export async function getBackendDir(
  backend: string,
  version: string
): Promise<string> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendDir = await joinPath([
    janDataFolderPath,
    'llamacpp',
    'backends',
    version,
    backend,
  ])
  return backendDir
}

export async function getBackendExePath(
  backend: string,
  version: string
): Promise<string> {
  const exe_name = IS_WINDOWS ? 'llama-server.exe' : 'llama-server'
  const backendDir = await getBackendDir(backend, version)
  let exePath: string
  const buildDir = await joinPath([backendDir, 'build'])
  if (await fs.existsSync(buildDir)) {
    exePath = await joinPath([backendDir, 'build', 'bin', exe_name])
  } else {
    exePath = await joinPath([backendDir, exe_name])
  }
  return exePath
}

export async function isBackendInstalled(
  backend: string,
  version: string
): Promise<boolean> {
  const exePath = await getBackendExePath(backend, version)
  const result = await fs.existsSync(exePath)
  return result
}

export async function downloadBackend(
  backend: string,
  version: string,
  source: 'github' | 'cdn' = 'github'
): Promise<void> {
  const janDataFolderPath = await getJanDataFolderPath()
  const llamacppPath = await joinPath([janDataFolderPath, 'llamacpp'])
  const backendDir = await getBackendDir(backend, version)
  const libDir = await joinPath([llamacppPath, 'lib'])

  const downloadManager = window.core.extensionManager.getByName(
    '@janhq/download-extension'
  )

  // Get proxy configuration from localStorage
  const proxyConfig = getProxyConfig()

  const platformName = IS_WINDOWS ? 'win' : 'linux'

  // Build URLs per source
  const backendUrl =
    source === 'github'
      ? `https://github.com/menloresearch/llama.cpp/releases/download/${version}/llama-${version}-bin-${backend}.tar.gz`
      : `https://catalog.jan.ai/llama.cpp/releases/${version}/llama-${version}-bin-${backend}.tar.gz`

  const downloadItems = [
    {
      url: backendUrl,
      save_path: await joinPath([backendDir, 'backend.tar.gz']),
      proxy: proxyConfig,
    },
  ]

  // also download CUDA runtime + cuBLAS + cuBLASLt if needed
  if (backend.includes('cu11.7') && !(await _isCudaInstalled('11.7'))) {
    downloadItems.push({
      url:
        source === 'github'
          ? `https://github.com/menloresearch/llama.cpp/releases/download/${version}/cudart-llama-bin-${platformName}-cu11.7-x64.tar.gz`
          : `https://catalog.jan.ai/llama.cpp/releases/${version}/cudart-llama-bin-${platformName}-cu11.7-x64.tar.gz`,
      save_path: await joinPath([libDir, 'cuda11.tar.gz']),
      proxy: proxyConfig,
    })
  } else if (backend.includes('cu12.0') && !(await _isCudaInstalled('12.0'))) {
    downloadItems.push({
      url:
        source === 'github'
          ? `https://github.com/menloresearch/llama.cpp/releases/download/${version}/cudart-llama-bin-${platformName}-cu12.0-x64.tar.gz`
          : `https://catalog.jan.ai/llama.cpp/releases/${version}/cudart-llama-bin-${platformName}-cu12.0-x64.tar.gz`,
      save_path: await joinPath([libDir, 'cuda12.tar.gz']),
      proxy: proxyConfig,
    })
  }

  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')
  const downloadType = 'Engine'

  console.log(
    `Downloading backend ${backend} version ${version} from ${source}: ${JSON.stringify(
      downloadItems
    )}`
  )
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
        const parentDir = await dirname(save_path)
        await invoke('decompress', { path: save_path, outputDir: parentDir })
        await fs.rm(save_path)
      }
    }

    events.emit('onFileDownloadSuccess', { modelId: taskId, downloadType })
  } catch (error) {
    // Fallback: if GitHub fails, retry once with CDN
    if (source === 'github') {
      console.warn(`GitHub download failed, falling back to CDN:`, error)
      return await downloadBackend(backend, version, 'cdn')
    }
    console.error(`Failed to download backend ${backend}: `, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}

async function _getSupportedFeatures() {
  const sysInfo = await getSystemInfo()
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
    // Vulkan support check
    if (gpuInfo.vulkan_info?.api_version) {
      features.vulkan = true
    }
  }
  return features
}

/**
 * Fetch releases with GitHub-first strategy and fallback to CDN on any error.
 * CDN endpoint is expected to mirror GitHub releases JSON shape.
 */
async function _fetchGithubReleases(
  owner: string,
  repo: string
): Promise<{ releases: any[]; source: 'github' | 'cdn' }> {
  const githubUrl = `https://api.github.com/repos/${owner}/${repo}/releases`
  try {
    const response = await fetch(githubUrl)
    if (!response.ok)
      throw new Error(`GitHub error: ${response.status} ${response.statusText}`)
    const releases = await response.json()
    return { releases, source: 'github' }
  } catch (_err) {
    const cdnUrl = 'https://catalog.jan.ai/llama.cpp/releases/releases.json'
    const response = await fetch(cdnUrl)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch releases from both sources. CDN error: ${response.status} ${response.statusText}`
      )
    }
    const releases = await response.json()
    return { releases, source: 'cdn' }
  }
}

async function _isCudaInstalled(version: string): Promise<boolean> {
  const sysInfo = await getSystemInfo()
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

  // check from system libraries first
  // TODO: might need to check for CuBLAS and CuBLASLt as well
  if (os_type === 'linux') {
    // not sure why libloading cannot find library from name alone
    // using full path here
    const libPath = `/usr/local/cuda/lib64/${libname}`
    if (await invoke<boolean>('is_library_available', { library: libPath }))
      return true
  } else if (os_type === 'windows') {
    // TODO: test this on Windows
    if (await invoke<boolean>('is_library_available', { library: libname }))
      return true
  }

  // check for libraries shipped with Jan's llama.cpp extension
  const janDataFolderPath = await getJanDataFolderPath()
  const cudartPath = await joinPath([
    janDataFolderPath,
    'llamacpp',
    'lib',
    libname,
  ])
  return await fs.existsSync(cudartPath)
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  const len = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < len; i++) {
    const x = aParts[i] || 0
    const y = bParts[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}
