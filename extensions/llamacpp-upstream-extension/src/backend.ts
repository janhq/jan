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
} from '../../../src-tauri/plugins/tauri-plugin-llamacpp-upstream/guest-js/index'

// Upstream provider points at the official ggml-org/llama.cpp release stream.
// Note: this is intentionally NOT janhq/llama.cpp (legacy fork mirror) and
// NOT AtomicBot-ai/atomic-llama-cpp-turboquant (our TurboQuant fork).
const LLAMACPP_RELEASES_API =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'
const LLAMACPP_DOWNLOAD_BASE =
  'https://github.com/ggml-org/llama.cpp/releases/download'

export async function getLocalInstalledBackends(): Promise<BackendVersion[]> {
  const janDataFolderPath = await getJanDataFolderPath()
  // Separate root from the turboquant extension to avoid stomping on each
  // other's installed backends.
  const backendDir = await joinPath([
    janDataFolderPath,
    'llamacpp-upstream',
    'backends',
  ])
  return await getLocalInstalledBackendsInternal(backendDir)
}
// folder structure
// <Jan's data folder>/llamacpp-upstream/backends/<backend_version>/<backend_type>

/**
 * Fetches the list of available backend builds from ggml-org/llama.cpp
 * GitHub releases for the current platform/arch.
 *
 * macOS: returns `[]` deliberately — see the ADR "Ship upstream
 * `ggml-org/llama.cpp` as a second macOS provider, no fork". macOS users
 * only get the bundled (re-codesigned) build that ships with each Atomic
 * Chat release.
 *
 * Windows: returns the ggml-org Windows assets (CPU / CUDA 12.4 / CUDA 13.1
 * / Vulkan) so the runtime update flow can fetch fresh builds without
 * shipping a new installer.
 *
 * Returns `[]` on network failure so the app can still work offline with
 * only bundled/local backends.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const osType = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  // macOS: bundled-only by design (see backend ADR). The upstream macOS
  // tarball is hand-picked + re-codesigned at build time; we deliberately
  // don't pull from ggml-org at runtime.
  if (osType === 'macos') {
    void LLAMACPP_RELEASES_API
    return []
  }

  // Currently only Windows uses the upstream provider at runtime. Linux
  // stays on the primary `llamacpp` provider (turboquant fork) and never
  // hits this code path. Bail early on anything else so we don't surface
  // surprising backend lists.
  if (osType !== 'windows') {
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

    // ggml-org Windows assets are zip archives named
    // `llama-{tag}-bin-{backend}.zip` (e.g.
    // `llama-b9284-bin-win-cuda-12.4-x64.zip`). Capture the backend infix.
    const re = new RegExp(
      `^llama-${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-bin-(win-.+)\\.zip$`
    )

    // Whitelist of ggml-org Windows backend ids we surface to the user.
    // Keeps less-relevant variants (hip-radeon / sycl / opencl-adreno /
    // arm64) hidden until we explicitly support them in the Rust matrix.
    const allowedBackends = new Set<string>([
      'win-cpu-x64',
      'win-cuda-12.4-x64',
      'win-cuda-13.1-x64',
      'win-vulkan-x64',
    ])

    const backends: BackendVersion[] = []

    for (const asset of assets) {
      const match = re.exec(asset.name)
      if (!match) continue

      const backendName = match[1]
      if (!allowedBackends.has(backendName)) continue
      if (!backendName.endsWith(`-${archSuffix}`)) continue

      backends.push({ version: tag, backend: backendName, order: 0 })
    }

    console.info(
      `[fetchRemoteBackends] Found ${backends.length} remote backends for win-${archSuffix}:`,
      backends.map((b) => b.backend)
    )
    return backends
  } catch (err) {
    console.warn('[fetchRemoteBackends] Failed to fetch remote backends:', err)
    return []
  }
}

/**
 * Builds the download URL for a specific backend version from ggml-org/llama.cpp.
 *
 * Asset naming differs by platform:
 *   - macOS: `llama-{tag}-bin-macos-{arm64,x64}.zip`
 *   - Windows: `llama-{tag}-bin-win-{variant}.zip`
 * Both formats are `.zip` (the Tauri `decompress` command handles both
 * `.tar.gz` and `.zip`).
 */
export function getBackendDownloadUrl(
  version: string,
  backend: string
): string {
  version = version.replace(/\uFEFF/g, '').trim()
  backend = backend.replace(/\uFEFF/g, '').trim()
  return `${LLAMACPP_DOWNLOAD_BASE}/${version}/llama-${version}-bin-${backend}.zip`
}

/**
 * Maps a Windows CUDA backend variant id (e.g. `win-cuda-13.1-x64`) to
 * the matching cudart asset on the same ggml-org/llama.cpp release.
 *
 * The main `llama-{tag}-bin-win-cuda-{12.4,13.1}-x64.zip` archives ship
 * only the llama-server executable and its direct deps; the CUDA Toolkit
 * runtime DLLs (cudart64_*.dll, cublas64_*.dll, cublasLt64_*.dll, …)
 * live in a sibling `cudart-llama-bin-win-cuda-{12.4,13.1}-x64.zip`.
 * Without those DLLs, `llama-server.exe --list-devices` returns an empty
 * device list on machines that don't have the CUDA Toolkit installed
 * system-wide (GitHub issue AtomicBot-ai/Atomic-Chat#14).
 *
 * ggml-org dropped CUDA 11 release artifacts — the lowest CUDA tier
 * shipped is CUDA 12.4. Hosts whose driver only supports CUDA 11 fall
 * back to the CPU build via runtime driver-version gating.
 */
const WINDOWS_CUDART_FILENAME: Record<'cuda-12.4' | 'cuda-13.1', string> = {
  'cuda-12.4': 'cudart-llama-bin-win-cuda-12.4-x64.zip',
  'cuda-13.1': 'cudart-llama-bin-win-cuda-13.1-x64.zip',
}

/**
 * Same mapping in CUDA-toolkit version form, for callers that need to
 * talk to `plugin:llamacpp-upstream|is_cuda_installed` (which keys on
 * the cudart version string, e.g. `12.4` / `13.1`) rather than the
 * backend variant id.
 */
const WINDOWS_CUDA_TOOLKIT_VERSION: Record<'cuda-12.4' | 'cuda-13.1', string> = {
  'cuda-12.4': '12.4',
  'cuda-13.1': '13.1',
}

const WINDOWS_CUDA_BACKEND_RE = /^win-(cuda-(?:12\.4|13\.1))-/

function matchWindowsCudaBackend(
  backend: string
): 'cuda-12.4' | 'cuda-13.1' | null {
  const match = WINDOWS_CUDA_BACKEND_RE.exec(backend.replace(/\uFEFF/g, '').trim())
  if (!match) return null
  return match[1] as 'cuda-12.4' | 'cuda-13.1'
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
 * Returns the CUDA Toolkit version string (e.g. `13.1`) that the Rust
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

  // Hardware-gated backend matrix applies on Windows: the user only sees
  // backends whose driver/Vulkan/CUDA requirements are actually met on
  // this host. macOS keeps the merged list unfiltered (every ggml-org
  // macOS asset is supported on the matching arch).
  if (osType !== 'windows') {
    void supportedBackends
    void mapOldBackendToNew
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
    'llamacpp-upstream',
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
