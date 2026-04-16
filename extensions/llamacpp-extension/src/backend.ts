import { getJanDataFolderPath, fs, joinPath, events } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { getProxyConfig } from './util'
import { dirname } from '@tauri-apps/api/path'
import { getSystemInfo } from '@janhq/tauri-plugin-hardware-api'
import {
  getLocalInstalledBackendsInternal,
  normalizeFeatures,
  determineSupportedBackends,
  listSupportedBackendsFromRust,
  BackendVersion,
  getSupportedFeaturesFromRust,
  isCudaInstalledFromRust,
} from '@janhq/tauri-plugin-llamacpp-api'

/*
 * Reads currently installed backends in janDataFolderPath
 *
 */
export async function getLocalInstalledBackends(): Promise<
  { version: string; backend: string }[]
> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendDir = await joinPath([
    janDataFolderPath,
    'llamacpp',
    'backends',
  ])
  return await getLocalInstalledBackendsInternal(backendDir)
}

// We ship upstream ggml-org/llama.cpp builds for "Check for Updates" because
// the janhq/llama.cpp fork's release cadence lags upstream by many builds.
// Upstream uses a different asset-naming scheme than the fork; we map its
// stems (e.g. "ubuntu-vulkan-x64") to Jan's internal backend names and
// remember per (version, backend) which archive to pull at download time.

interface UpstreamAssetInfo {
  assetFileName: string
  cudartAssetFileName?: string
}

const upstreamAssetMap = new Map<string, UpstreamAssetInfo>()
const upstreamKey = (version: string, backend: string) =>
  `${version}|${backend}`

// Convert upstream ggml-org release asset stem (filename without
// "llama-<ver>-bin-" prefix and without ".tar.gz"/".zip" suffix) to the
// internal backend identifier Jan uses elsewhere. Returns null if the asset
// does not correspond to a backend Jan supports.
export function mapUpstreamAssetToInternal(stem: string): string | null {
  switch (stem) {
    case 'macos-arm64':
      return 'macos-arm64'
    case 'macos-x64':
      return 'macos-x64'
    case 'ubuntu-x64':
      return 'linux-common_cpus-x64'
    case 'ubuntu-arm64':
      return 'linux-arm64'
    case 'ubuntu-vulkan-x64':
      return 'linux-vulkan-common_cpus-x64'
    case 'win-cpu-x64':
      return 'win-common_cpus-x64'
    case 'win-cpu-arm64':
      return 'win-arm64'
    case 'win-vulkan-x64':
      return 'win-vulkan-common_cpus-x64'
  }
  // Upstream ships "win-cuda-<major>.<minor>-x64" (e.g. win-cuda-12.4-x64).
  // Jan buckets CUDA by major version only.
  const cudaMatch = /^win-cuda-(\d+)\.(\d+)-x64$/.exec(stem)
  if (cudaMatch) {
    return `win-cuda-${cudaMatch[1]}-common_cpus-x64`
  }
  return null
}

/*
 * Fetch available remote backends from upstream ggml-org/llama.cpp.
 * Populates upstreamAssetMap with the actual asset filenames so
 * downloadBackend knows what to pull.
 */
async function fetchRemoteSupportedBackends(
  supportedBackends: string[]
): Promise<{ version: string; backend: string }[]> {
  const { releases } = await _fetchGithubReleases('ggml-org', 'llama.cpp')
  releases.sort((a, b) =>
    b.tag_name.localeCompare(a.tag_name, undefined, { numeric: true })
  )
  releases.splice(10) // keep only the latest 10 releases

  // Clear stale entries from prior fetches so the map doesn't grow unboundedly
  // across repeated settings-page visits within a single session.
  upstreamAssetMap.clear()

  const remote: { version: string; backend: string }[] = []

  for (const release of releases) {
    const version = release.tag_name
    const prefix = `llama-${version}-bin-`

    // Index CUDA runtime archives present in this release, keyed by CUDA
    // major version. Upstream only ships Windows CUDA runtimes.
    const cudartByMajor: Record<string, string> = {}
    for (const asset of release.assets) {
      const m = /^cudart-llama-bin-win-cuda-(\d+)\.(\d+)-x64\.zip$/.exec(
        asset.name
      )
      if (m) cudartByMajor[m[1]] = asset.name
    }

    for (const asset of release.assets) {
      const name = asset.name
      if (!name.startsWith(prefix)) continue

      let stem: string
      if (name.endsWith('.tar.gz')) {
        stem = name.slice(prefix.length, -'.tar.gz'.length)
      } else if (name.endsWith('.zip')) {
        stem = name.slice(prefix.length, -'.zip'.length)
      } else {
        continue
      }

      const internal = mapUpstreamAssetToInternal(stem)
      if (!internal) continue
      if (!supportedBackends.includes(internal)) continue

      const cudaMajor = /^win-cuda-(\d+)-common_cpus-x64$/.exec(internal)?.[1]
      upstreamAssetMap.set(upstreamKey(version, internal), {
        assetFileName: name,
        cudartAssetFileName: cudaMajor ? cudartByMajor[cudaMajor] : undefined,
      })
      remote.push({ version, backend: internal })
    }
  }

  return remote
}

// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_version>/<backend_type>

// what should be available to the user for selection?
export async function listSupportedBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const osType = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  const rawFeatures = await _getSupportedFeatures()
  const features = normalizeFeatures(rawFeatures)

  // Get supported backend names from Rust
  const supportedBackends = await determineSupportedBackends(
    osType,
    arch,
    features
  )

  // Get remote backends from Github
  let remoteBackendVersions: BackendVersion[] = []
  try {
    remoteBackendVersions =
      await fetchRemoteSupportedBackends(supportedBackends)
  } catch (e) {
    console.debug(
      `Not able to get remote backends, Jan might be offline or network problem: ${String(e)}`
    )
  }

  // Get locally installed versions
  const localBackendVersions = await getLocalInstalledBackends()

  // Merge & sort via Rust
  return listSupportedBackendsFromRust(
    remoteBackendVersions,
    localBackendVersions
  )
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
  version: string
): Promise<void> {
  const backendDir = await getBackendDir(backend, version)

  const downloadManager = window.core.extensionManager.getByName(
    '@janhq/download-extension'
  )

  // Get proxy configuration from localStorage
  const proxyConfig = getProxyConfig()

  // If we don't have the asset info cached (e.g. user never opened the
  // backends list this session), refresh it before downloading.
  let assetInfo = upstreamAssetMap.get(upstreamKey(version, backend))
  if (!assetInfo) {
    try {
      await listSupportedBackends()
      assetInfo = upstreamAssetMap.get(upstreamKey(version, backend))
    } catch (e) {
      console.warn(
        `Could not refresh upstream release index before download: ${String(e)}`
      )
    }
  }
  if (!assetInfo) {
    throw new Error(
      `No upstream release asset known for ${backend} @ ${version}. Use "Install Backend from File" for this backend.`
    )
  }

  const upstreamBase = 'https://github.com/ggml-org/llama.cpp/releases/download'
  const backendUrl = `${upstreamBase}/${version}/${assetInfo.assetFileName}`
  const archiveFileName = assetInfo.assetFileName.endsWith('.zip')
    ? 'backend.zip'
    : 'backend.tar.gz'

  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')

  const downloadItems = [
    {
      url: backendUrl,
      save_path: await joinPath([backendDir, archiveFileName]),
      proxy: proxyConfig,
      model_id: taskId,
    },
  ]

  // Windows CUDA backends also need the matching CUDA runtime zip. Upstream
  // only ships Windows CUDA runtimes (no Linux CUDA builds at all).
  const cudaMajor = /^win-cuda-(\d+)-common_cpus-x64$/.exec(backend)?.[1]
  if (
    cudaMajor &&
    assetInfo.cudartAssetFileName &&
    !(await _isCudaInstalled(backendDir, `${cudaMajor}.0`))
  ) {
    downloadItems.push({
      url: `${upstreamBase}/${version}/${assetInfo.cudartAssetFileName}`,
      save_path: await joinPath([
        backendDir,
        'build',
        'bin',
        assetInfo.cudartAssetFileName.endsWith('.zip')
          ? `cuda${cudaMajor}.zip`
          : `cuda${cudaMajor}.tar.gz`,
      ]),
      proxy: proxyConfig,
      model_id: taskId,
    })
  }

  const downloadType = 'Engine'

  console.log(
    `Downloading backend ${backend} version ${version} from upstream: ${JSON.stringify(
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

    // decompress the downloaded archives
    for (const { save_path } of downloadItems) {
      if (save_path.endsWith('.tar.gz') || save_path.endsWith('.zip')) {
        const parentDir = await dirname(save_path)
        await invoke('decompress', { path: save_path, outputDir: parentDir })
        await fs.rm(save_path)
      }
    }

    events.emit('onFileDownloadSuccess', { modelId: taskId, downloadType })
  } catch (error) {
    if (error?.toString() === 'Error: Download cancelled') {
      events.emit('onFileDownloadStopped', { modelId: taskId, downloadType })
      return
    }
    console.error(`Failed to download backend ${backend}: `, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}

async function _getSupportedFeatures() {
  const sysInfo = await getSystemInfo()
  return await getSupportedFeaturesFromRust(
    sysInfo.os_type,
    sysInfo.cpu.extensions,
    sysInfo.gpus
  )
}

/**
 * Fetch releases from GitHub API.
 *
 * The CDN fallback (catalog.jan.ai) is intentionally NOT used for upstream
 * ggml-org/llama.cpp queries because the CDN mirrors the janhq/llama.cpp fork
 * whose asset names are incompatible with mapUpstreamAssetToInternal(). If the
 * GitHub API is unavailable (rate-limited, offline, etc.) the error propagates
 * to the caller so users see a clear network error instead of a silent
 * "no updates available" with zero matches.
 */
async function _fetchGithubReleases(
  owner: string,
  repo: string
): Promise<{ releases: any[] }> {
  const githubUrl = `https://api.github.com/repos/${owner}/${repo}/releases`
  const response = await fetch(githubUrl)
  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}. ` +
        `Release list unavailable — check network or try again later.`
    )
  }
  const releases = await response.json()
  return { releases }
}

// accept backendDir (full path) and cuda version (e.g. '11.7' or '12.0' or '13.0')
async function _isCudaInstalled(
  backendDir: string,
  version: string
): Promise<boolean> {
  const sysInfo = await getSystemInfo()
  const janDataFolderPath = await getJanDataFolderPath()

  return isCudaInstalledFromRust(
    backendDir,
    version,
    sysInfo.os_type,
    janDataFolderPath
  )
}
