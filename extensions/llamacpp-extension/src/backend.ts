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

// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_version>/<backend_type>

// what should be available to the user for selection?
export async function listSupportedBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const rawFeatures = await getSupportedFeaturesFromRust(
    sysInfo.os_type,
    sysInfo.cpu.extensions,
    sysInfo.gpus
  )
  const features = normalizeFeatures(rawFeatures)

  // Get supported backend names from Rust
  const supportedBackends = await determineSupportedBackends(
    sysInfo.os_type,
    sysInfo.cpu.arch,
    features
  )

  // Get remote backends via Rust (handles GitHub + CDN fallback)
  let remoteBackendVersions: BackendVersion[] = []
  try {
    remoteBackendVersions = await invoke(
      'plugin:llamacpp|fetch_remote_supported_backends',
      { supportedBackends }
    )
  } catch (e) {
    console.debug(
      `Not able to get remote backends, Jan might be offline or network problem: ${String(e)}`
    )
  }

  // Get locally installed versions
  const localBackendVersions = await getLocalInstalledBackends()

  // Merge & sort via Rust
  return listSupportedBackendsFromRust(remoteBackendVersions, localBackendVersions)
}

export async function getBackendDir(
  backend: string,
  version: string
): Promise<string> {
  const janDataFolder = await getJanDataFolderPath()
  return invoke<string>('plugin:llamacpp|get_backend_dir', {
    backend,
    version,
    janDataFolder,
  })
}

export async function getBackendExePath(
  backend: string,
  version: string
): Promise<string> {
  const janDataFolder = await getJanDataFolderPath()
  return invoke<string>('plugin:llamacpp|get_backend_exe_path', {
    backend,
    version,
    janDataFolder,
    isWindows: IS_WINDOWS,
  })
}

export async function isBackendInstalled(
  backend: string,
  version: string
): Promise<boolean> {
  const janDataFolder = await getJanDataFolderPath()
  return invoke<boolean>('plugin:llamacpp|check_backend_installed', {
    backend,
    version,
    janDataFolder,
    isWindows: IS_WINDOWS,
  })
}

export async function downloadBackend(
  backend: string,
  version: string,
  source: 'github' | 'cdn' = 'github'
): Promise<void> {
  const janDataFolderPath = await getJanDataFolderPath()
  const sysInfo = await getSystemInfo()
  const proxyConfig = getProxyConfig()

  const downloadItems: Array<{
    url: string
    save_path: string
    model_id: string
    proxy?: object
  }> = await invoke('plugin:llamacpp|build_backend_download_items', {
    backend,
    version,
    source,
    janDataFolder: janDataFolderPath,
    osType: sysInfo.os_type,
  })

  // Attach proxy config to each item
  const itemsWithProxy = downloadItems.map((item) => ({
    ...item,
    proxy: proxyConfig,
  }))

  const downloadManager = window.core.extensionManager.getByName(
    '@janhq/download-extension'
  )
  const taskId = `llamacpp-${version}-${backend}`.replace(/\./g, '-')
  const downloadType = 'Engine'

  console.log(
    `Downloading backend ${backend} version ${version} from ${source}: ${JSON.stringify(itemsWithProxy)}`
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
    await downloadManager.downloadFiles(itemsWithProxy, taskId, onProgress)

    if (!downloadCompleted) {
      events.emit('onFileDownloadStopped', { modelId: taskId, downloadType })
      return
    }

    for (const { save_path } of downloadItems) {
      if (save_path.endsWith('.tar.gz')) {
        const parentDir = await dirname(save_path)
        await invoke('decompress', { path: save_path, outputDir: parentDir })
        await fs.rm(save_path)
      }
    }

    events.emit('onFileDownloadSuccess', { modelId: taskId, downloadType })
  } catch (error) {
    if (
      source === 'github' &&
      error?.toString() !== 'Error: Download cancelled'
    ) {
      console.warn(`GitHub download failed, falling back to CDN:`, error)
      return await downloadBackend(backend, version, 'cdn')
    }
    console.error(`Failed to download backend ${backend}: `, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}
