import { getJanDataFolderPath, fs, joinPath } from '@janhq/core'
import { getSystemInfo } from './hardware'
import {
  getLocalInstalledBackendsInternal,
  normalizeFeatures,
  determineSupportedBackends,
  listSupportedBackendsFromRust,
  BackendVersion,
  getSupportedFeaturesFromRust,
  mapOldBackendToNew,
} from '../../../src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index'

const LLAMACPP_RELEASES_API =
  'https://api.github.com/repos/janhq/llama.cpp/releases/latest'
const LLAMACPP_DOWNLOAD_BASE =
  'https://github.com/janhq/llama.cpp/releases/download'

export async function getLocalInstalledBackends(): Promise<BackendVersion[]> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendDir = await joinPath([janDataFolderPath, 'llamacpp', 'backends'])
  return await getLocalInstalledBackendsInternal(backendDir)
}
// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_version>/<backend_type>

/**
 * Fetches the list of available backend builds from janhq/llama.cpp GitHub
 * releases, filtered to the current platform (win/linux/macos) and arch.
 * Returns an empty array on network failure so the app can still work offline
 * with only bundled/local backends.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const osType = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  // macOS uses a separate turboquant repository (AtomicBot-ai/atomic-llama-cpp-turboquant),
  // not janhq/llama.cpp, so remote backend fetching only applies to Windows and Linux.
  let platformPrefix: string
  if (osType === 'windows') {
    platformPrefix = 'win-'
  } else if (osType === 'linux') {
    platformPrefix = 'linux-'
  } else {
    return []
  }

  const archSuffix =
    arch.includes('aarch64') || arch.includes('arm64') ? 'arm64' : 'x64'

  try {
    console.info(`[fetchRemoteBackends] Fetching ${LLAMACPP_RELEASES_API}...`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let resp: Response
    try {
      resp = await fetch(LLAMACPP_RELEASES_API, {
        headers: { 'User-Agent': 'atomic-chat' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!resp.ok) {
      const rateLimitRemaining = resp.headers.get('x-ratelimit-remaining')
      console.warn(
        `[fetchRemoteBackends] GitHub API returned ${resp.status} (rate-limit-remaining: ${rateLimitRemaining}), using local backends only`
      )
      return []
    }

    const release = await resp.json()
    const tag: string = release.tag_name
    if (!tag) return []

    const assets: { name: string }[] = release.assets ?? []

    const re = new RegExp(
      `^llama-${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-bin-(.+)\\.tar\\.gz$`
    )

    const backends: BackendVersion[] = []

    for (const asset of assets) {
      const match = re.exec(asset.name)
      if (!match) continue

      const backendName = match[1]
      if (!backendName.startsWith(platformPrefix)) continue

      const matchesArch =
        backendName.endsWith(`-${archSuffix}`) ||
        backendName === `${platformPrefix}${archSuffix}`
      if (!matchesArch) continue

      backends.push({ version: tag, backend: backendName, order: 0 })
    }

    console.info(
      `[fetchRemoteBackends] Found ${backends.length} remote backends for ${platformPrefix}${archSuffix}:`,
      backends.map((b) => b.backend)
    )
    return backends
  } catch (err) {
    console.warn('[fetchRemoteBackends] Failed to fetch remote backends:', err)
    return []
  }
}

/**
 * Builds the download URL for a specific backend version from janhq/llama.cpp.
 */
export function getBackendDownloadUrl(
  version: string,
  backend: string
): string {
  version = version.replace(/\uFEFF/g, '').trim()
  backend = backend.replace(/\uFEFF/g, '').trim()
  return `${LLAMACPP_DOWNLOAD_BASE}/${version}/llama-${version}-bin-${backend}.tar.gz`
}

/**
 * Maps a Windows CUDA backend variant id (e.g. `win-cuda-13-common_cpus-x64`)
 * to the matching cudart asset on the same janhq/llama.cpp release.
 *
 * The main `llama-*-bin-win-cuda-{11,12,13}-*.tar.gz` archives ship only the
 * llama-server executable and its direct deps; the CUDA Toolkit runtime
 * DLLs (cudart64_*.dll, cublas64_*.dll, cublasLt64_*.dll, …) live in a
 * sibling `cudart-llama-bin-win-cu{X.Y}-x64.tar.gz`. Without those DLLs,
 * `llama-server.exe --list-devices` returns an empty device list on
 * machines that don't have the CUDA Toolkit installed system-wide
 * (GitHub issue AtomicBot-ai/Atomic-Chat#14).
 *
 * The mapping has been stable across janhq releases since the CUDA-13
 * variant was introduced.
 */
const WINDOWS_CUDART_FILENAME: Record<'cuda-11' | 'cuda-12' | 'cuda-13', string> = {
  'cuda-11': 'cudart-llama-bin-win-cu11.7-x64.tar.gz',
  'cuda-12': 'cudart-llama-bin-win-cu12.0-x64.tar.gz',
  'cuda-13': 'cudart-llama-bin-win-cu13.0-x64.tar.gz',
}

/**
 * Same mapping in CUDA-toolkit version form, for callers that need to
 * talk to `plugin:llamacpp|is_cuda_installed` (which keys on the cudart
 * version string, e.g. `11.7` / `12.0` / `13.0`) rather than the
 * backend variant id.
 */
const WINDOWS_CUDA_TOOLKIT_VERSION: Record<'cuda-11' | 'cuda-12' | 'cuda-13', string> = {
  'cuda-11': '11.7',
  'cuda-12': '12.0',
  'cuda-13': '13.0',
}

const WINDOWS_CUDA_BACKEND_RE = /^win-(cuda-(?:11|12|13))-/

function matchWindowsCudaBackend(
  backend: string
): 'cuda-11' | 'cuda-12' | 'cuda-13' | null {
  const match = WINDOWS_CUDA_BACKEND_RE.exec(backend.replace(/\uFEFF/g, '').trim())
  if (!match) return null
  return match[1] as 'cuda-11' | 'cuda-12' | 'cuda-13'
}

/**
 * Returns the download URL for the cudart companion archive that must be
 * merged into `<backendDir>/build/bin/` for a Windows CUDA backend, or
 * `null` if `backend` is not one of the Windows CUDA variants.
 */
export function getCudartDownloadUrl(
  version: string,
  backend: string
): string | null {
  const cudaKey = matchWindowsCudaBackend(backend)
  if (!cudaKey) return null
  const filename = WINDOWS_CUDART_FILENAME[cudaKey]
  const cleanVersion = version.replace(/\uFEFF/g, '').trim()
  return `${LLAMACPP_DOWNLOAD_BASE}/${cleanVersion}/${filename}`
}

/**
 * Returns the cudart filename (without URL) for a Windows CUDA backend,
 * or `null` if the backend is not a Windows CUDA variant.
 */
export function getCudartArchiveName(backend: string): string | null {
  const cudaKey = matchWindowsCudaBackend(backend)
  if (!cudaKey) return null
  return WINDOWS_CUDART_FILENAME[cudaKey]
}

/**
 * Returns the CUDA Toolkit version string (e.g. `13.0`) that the Rust
 * `is_cuda_installed` command expects for a given Windows CUDA backend.
 * `null` for non-CUDA backends.
 */
export function getCudaToolkitVersion(backend: string): string | null {
  const cudaKey = matchWindowsCudaBackend(backend)
  if (!cudaKey) return null
  return WINDOWS_CUDA_TOOLKIT_VERSION[cudaKey]
}

export async function listSupportedBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const osType = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  console.info('[listSupportedBackends] sysInfo:', osType, arch)

  const rawFeatures = await _getSupportedFeatures()
  const features = normalizeFeatures(rawFeatures)

  const supportedBackends = await determineSupportedBackends(
    osType,
    arch,
    features
  )
  console.info('[listSupportedBackends] supportedBackends:', supportedBackends)

  const [localBackendVersions, remoteBackendVersions] = await Promise.all([
    getLocalInstalledBackends(),
    fetchRemoteBackends(),
  ])
  console.info(
    '[listSupportedBackends] local backends:',
    localBackendVersions.length,
    localBackendVersions
  )
  console.info(
    '[listSupportedBackends] remote backends:',
    remoteBackendVersions.length,
    remoteBackendVersions.map((b) => `${b.version}/${b.backend}`)
  )

  const mergedBackends = await listSupportedBackendsFromRust(
    remoteBackendVersions,
    localBackendVersions
  )

  // Only Windows uses the hardware-gated llama.cpp backend matrix. Keep macOS on
  // its separate turboquant flow and avoid altering Linux behavior here.
  if (osType !== 'windows') {
    return mergedBackends
  }

  const supportedSet = new Set(supportedBackends)
  const filteredBackends = await Promise.all(
    mergedBackends.map(async (backendInfo) => ({
      backendInfo,
      normalizedBackend: await mapOldBackendToNew(backendInfo.backend),
    }))
  )

  const supportedMergedBackends = filteredBackends
    .filter(({ normalizedBackend }) => supportedSet.has(normalizedBackend))
    .map(({ backendInfo }) => backendInfo)

  console.info(
    '[listSupportedBackends] windows filtered backends:',
    supportedMergedBackends.length,
    supportedMergedBackends.map((b) => `${b.version}/${b.backend}`)
  )

  return supportedMergedBackends
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
    version.replace(/\uFEFF/g, '').trim(),
    backend.replace(/\uFEFF/g, '').trim(),
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

async function _getSupportedFeatures() {
  const sysInfo = await getSystemInfo()
  return await getSupportedFeaturesFromRust(
    sysInfo.os_type,
    sysInfo.cpu.extensions,
    sysInfo.gpus
  )
}
