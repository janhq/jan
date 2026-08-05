import { getJanDataFolderPath, fs, joinPath, events, logger } from '@janhq/core'
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
  fetchBackendChecksums,
  verifyFileSha512,
  probeBackendLoad,
  type LoadProbeResult,
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
/**
 * Hardware-supported backends published by upstream. Excludes
 * locally-installed-only entries, so the "recommended backend" calculation
 * isn't biased by user side-loads.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const rawFeatures = await getSupportedFeaturesFromRust(
    sysInfo.os_type,
    sysInfo.cpu.extensions,
    sysInfo.gpus
  )
  const features = normalizeFeatures(rawFeatures)
  const supportedBackends = await determineSupportedBackends(
    sysInfo.os_type,
    sysInfo.cpu.arch,
    features
  )

  try {
    return await invoke<BackendVersion[]>(
      'plugin:llamacpp|fetch_remote_supported_backends',
      { supportedBackends, proxy: await getProxyConfig() }
    )
  } catch (e) {
    logger.debug(
      `Not able to get remote backends, Jan might be offline or network problem: ${String(e)}`
    )
    return []
  }
}

export async function listSupportedBackends(
  checkRemote: boolean = true
): Promise<BackendVersion[]> {
  const remoteBackendVersions = checkRemote ? await fetchRemoteBackends() : []
  const localBackendVersions = await getLocalInstalledBackends()
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

export type BackendVerificationResult = {
  verified: boolean
  missing_libraries: string[]
  resolved_libraries: string[]
}

/**
 * Loads the backend's GPU library the way llama-server would, to recover the
 * reason it cannot. A release build of ggml discards that error and silently
 * falls back to CPU, so this is the only way to name the missing dependency.
 */
export async function probeBackendGpuLibraries(
  backend: string,
  version: string
): Promise<LoadProbeResult> {
  const janDataFolder = await getJanDataFolderPath()
  return probeBackendLoad(backend, version, janDataFolder, IS_WINDOWS)
}

export async function verifyBackendInstallation(
  backend: string,
  version: string
): Promise<BackendVerificationResult> {
  const janDataFolder = await getJanDataFolderPath()
  return invoke<BackendVerificationResult>(
    'plugin:llamacpp|verify_backend_installation',
    {
      backend,
      version,
      janDataFolder,
      isWindows: IS_WINDOWS,
    }
  )
}

/**
 * Check downloaded archives against the release's `checksum.yml` before they
 * are unpacked.
 *
 * Fail-soft on a missing manifest or a missing entry, and deliberately so:
 * releases published before the manifest existed -- and those whose entries
 * predate the `-bin-` naming fix in janhq/llama.cpp db8b2fcd -- carry no usable
 * digest, and refusing to install them would strand every older version, which
 * is exactly what rollback depends on. A digest that IS present and does not
 * match is a hard failure: the file is removed so a retry cannot reuse it.
 */
async function verifyDownloadedArchives(
  savePaths: string[],
  version: string,
  source: 'github' | 'cdn',
  proxyConfig: object | null
): Promise<void> {
  let checksums: Record<string, string> = {}
  try {
    checksums = await fetchBackendChecksums(version, source, proxyConfig)
  } catch (e) {
    logger.warn(`Could not load checksum.yml for ${version}:`, e)
    return
  }
  if (!Object.keys(checksums).length) {
    logger.warn(
      `No usable checksums published for ${version}; skipping verification`
    )
    return
  }

  for (const savePath of savePaths) {
    const name = savePath.split(/[\\/]/).pop() ?? ''
    const expected = checksums[name]
    if (!expected) {
      logger.warn(`No checksum entry for ${name}; skipping verification`)
      continue
    }
    if (await verifyFileSha512(savePath, expected)) {
      logger.info(`Checksum verified for ${name}`)
      continue
    }
    await fs.rm(savePath).catch(() => undefined)
    throw new Error(
      `Checksum mismatch for ${name}; the download was corrupt or tampered with`
    )
  }
}

export async function downloadBackend(
  backend: string,
  version: string,
  source: 'github' | 'cdn' = 'github'
): Promise<void> {
  const janDataFolderPath = await getJanDataFolderPath()
  const sysInfo = await getSystemInfo()
  const proxyConfig = await getProxyConfig()

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

  logger.info(
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

    await verifyDownloadedArchives(
      itemsWithProxy.map((i) => i.save_path),
      version,
      source,
      proxyConfig
    )

    for (const { save_path } of itemsWithProxy) {
      // Official Windows HIP assets ship as .zip; everything else is .tar.gz.
      if (save_path.endsWith('.tar.gz') || save_path.endsWith('.zip')) {
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
      logger.warn(`GitHub download failed, falling back to CDN:`, error)
      return await downloadBackend(backend, version, 'cdn')
    }
    logger.error(`Failed to download backend ${backend}: `, error)
    events.emit('onFileDownloadError', { modelId: taskId, downloadType })
    throw error
  }
}
