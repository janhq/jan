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
 * Mirror of the turboquant extension's macOS behavior: on every supported
 * platform we deliberately do NOT poll `ggml-org/llama.cpp` releases at
 * runtime. Backend upgrades ship together with new Atomic Chat releases —
 * the bundled binary that lands in `src-tauri/resources/llamacpp-backend-upstream/`
 * via `make download-llamacpp-upstream-backend` is the single source of
 * truth, alongside any backends the user previously installed locally.
 *
 * Rationale (matches turboquant on macOS):
 *   - Predictable QA: every shipped DMG/installer pairs the UI with a known
 *     `llama-server` build that we re-signed for notarization.
 *   - Avoids GitHub API rate limits and silent runtime upgrades that can
 *     change inference behavior between app launches without any release
 *     notes.
 *   - Keeps the provider settings dropdown stable — only options the user
 *     can actually run today are listed.
 *
 * The function is kept as an async returning `[]` so the rest of
 * `configureBackends()` keeps its existing shape (bundled + local merge).
 * Re-enable remote fetching only if/when we want runtime updates to
 * decouple from app releases — that should be a deliberate ADR-level
 * change, not an opportunistic one.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  void LLAMACPP_RELEASES_API
  return []
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

  // The Windows-only hardware-gated backend matrix lives in the turboquant
  // extension. The upstream extension is macOS-only and returns the merged
  // list unfiltered — every upstream macOS asset (arm64 / x64) is supported.
  void supportedBackends
  void mapOldBackendToNew
  return mergedBackends
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
