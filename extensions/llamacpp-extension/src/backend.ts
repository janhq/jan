import { getJanDataFolderPath, fs, joinPath, events } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { getProxyConfig, basenameNoExt } from './util'
import { dirname } from '@tauri-apps/api/path'
import { getSystemInfo } from '@janhq/tauri-plugin-hardware-api'
import {
  mapOldBackendToNew,
  getLocalInstalledBackendsInternal,
  normalizeFeatures,
  determineSupportedBackends,
  listSupportedBackendsFromRust,
  BackendVersion,
  getSupportedFeaturesFromRust,
  isCudaInstalledFromRust,
} from '@janhq/tauri-plugin-llamacpp-api'

export type BackendSource = 'janhq' | 'turboquant'

function resolveBackendRepo(source: BackendSource): {
  owner: string
  repo: string
} {
  if (source === 'turboquant') {
    return { owner: 'TheTom', repo: 'llama-cpp-turboquant' }
  }
  return { owner: 'janhq', repo: 'llama.cpp' }
}

function extractBackendName(assetName: string, version: string): string | null {
  const prefix = `llama-${version}-bin-`
  if (assetName.startsWith(prefix)) {
    return basenameNoExt(assetName).slice(prefix.length)
  }
  const genericMatch = basenameNoExt(assetName).match(/-bin-(.+)$/)
  return genericMatch?.[1] ?? null
}

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
/*
 * currently reads available backends in remote
 *
 */
async function fetchRemoteSupportedBackends(
  supportedBackends: string[],
  source: BackendSource
): Promise<{ version: string; backend: string }[]> {
  const { owner, repo } = resolveBackendRepo(source)
  // Pull the latest releases from the repo
  const { releases } = await _fetchGithubReleases(owner, repo, source)
  releases.sort((a, b) => b.tag_name.localeCompare(a.tag_name))
  releases.splice(10) // keep only the latest 10 releases

  // Walk the assets and keep only those that match a supported backend
  const remote: { version: string; backend: string }[] = []

  for (const release of releases) {
    const version = release.tag_name

    for (const asset of release.assets) {
      const name = asset.name

      const backend = extractBackendName(name, version)
      if (!backend) continue

      if (supportedBackends.includes(backend)) {
        remote.push({ version, backend })
        continue
      }
      const mappedNew = await mapOldBackendToNew(backend)
      if (mappedNew !== backend && supportedBackends.includes(mappedNew)) {
        // Push the ORIGINAL backend name here, as this is the name of the file on the server.
        remote.push({ version, backend })
      }
    }
  }

  return remote
}

// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_version>/<backend_type>

// what should be available to the user for selection?
export async function listSupportedBackends(
  source: BackendSource = 'janhq'
): Promise<BackendVersion[]> {
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
      await fetchRemoteSupportedBackends(supportedBackends, source)
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
  version: string,
  source: BackendSource = 'janhq',
  downloadSource: 'github' | 'cdn' = 'github'
): Promise<void> {
  const backendDir = await getBackendDir(backend, version)

  const downloadManager = window.core.extensionManager.getByName(
    '@janhq/download-extension'
  )

  // Get proxy configuration from localStorage
  const proxyConfig = getProxyConfig()

  const platformName = IS_WINDOWS ? 'win' : 'linux'

  const { owner, repo } = resolveBackendRepo(source)

  // Build URLs per source
  const backendUrl =
    downloadSource === 'github'
      ? `https://github.com/${owner}/${repo}/releases/download/${version}/llama-${version}-bin-${backend}.tar.gz`
      : `https://catalog.jan.ai/llama.cpp/releases/${version}/llama-${version}-bin-${backend}.tar.gz`

  const taskId = `llamacpp-${source}-${version}-${backend}`.replace(/\./g, '-')

  const downloadItems = [
    {
      url: backendUrl,
      save_path: await joinPath([backendDir, 'backend.tar.gz']),
      proxy: proxyConfig,
      model_id: taskId,
    },
  ]

  // also download CUDA runtime + cuBLAS + cuBLASLt if needed
  if (
    (backend.includes('cu11.7') || backend.includes('cuda-11')) &&
    !(await _isCudaInstalled(backendDir, '11.7'))
  ) {
    downloadItems.push({
      url:
        source === 'github'
          ? `https://github.com/janhq/llama.cpp/releases/download/${version}/cudart-llama-bin-${platformName}-cu11.7-x64.tar.gz`
          : `https://catalog.jan.ai/llama.cpp/releases/${version}/cudart-llama-bin-${platformName}-cu11.7-x64.tar.gz`,
      save_path: await joinPath([backendDir, 'build', 'bin', 'cuda11.tar.gz']),
      proxy: proxyConfig,
      model_id: taskId,
    })
  } else if (
    (backend.includes('cu12.0') || backend.includes('cuda-12')) &&
    !(await _isCudaInstalled(backendDir, '12.0'))
  ) {
    downloadItems.push({
      url:
        source === 'github'
          ? `https://github.com/janhq/llama.cpp/releases/download/${version}/cudart-llama-bin-${platformName}-cu12.0-x64.tar.gz`
          : `https://catalog.jan.ai/llama.cpp/releases/${version}/cudart-llama-bin-${platformName}-cu12.0-x64.tar.gz`,
      save_path: await joinPath([backendDir, 'build', 'bin', 'cuda12.tar.gz']),
      proxy: proxyConfig,
      model_id: taskId,
    })
  } else if (
    backend.includes('cuda-13') &&
    !(await _isCudaInstalled(backendDir, '13.0'))
  ) {
    downloadItems.push({
      url:
        source === 'github'
          ? `https://github.com/janhq/llama.cpp/releases/download/${version}/cudart-llama-bin-${platformName}-cu13.0-x64.tar.gz`
          : `https://catalog.jan.ai/llama.cpp/releases/${version}/cudart-llama-bin-${platformName}-cu13.0-x64.tar.gz`,
      save_path: await joinPath([backendDir, 'build', 'bin', 'cuda13.tar.gz']),
      proxy: proxyConfig,
      model_id: taskId,
    })
  }
  const downloadType = 'Engine'

  console.log(
    `Downloading backend ${backend} version ${version} (${source}) via ${downloadSource}: ${JSON.stringify(
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
    if (
      source === 'janhq' &&
      downloadSource === 'github' &&
      error?.toString() !== 'Error: Download cancelled'
    ) {
      console.warn(`GitHub download failed, falling back to CDN:`, error)
      return await downloadBackend(backend, version, source, 'cdn')
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
 * Fetch releases with GitHub-first strategy and fallback to CDN on any error.
 * CDN endpoint is expected to mirror GitHub releases JSON shape.
 */
async function _fetchGithubReleases(
  owner: string,
  repo: string,
  source: BackendSource
): Promise<{ releases: any[]; source: 'github' | 'cdn' }> {
  const githubUrl = `https://api.github.com/repos/${owner}/${repo}/releases`
  try {
    const response = await fetch(githubUrl)
    if (!response.ok)
      throw new Error(`GitHub error: ${response.status} ${response.statusText}`)
    const releases = await response.json()
    return { releases, source: 'github' }
  } catch (_err) {
    if (source === 'turboquant') {
      throw _err
    }
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
