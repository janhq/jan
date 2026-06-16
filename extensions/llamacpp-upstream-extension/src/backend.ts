import { getJanDataFolderPath, fs, joinPath } from '@janhq/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { getSystemInfo } from './hardware'
import { getProxyConfig } from './util'
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
 * Mapping from internal Linux backend id → ggml-org upstream asset name
 * infix (the part between `bin-` and `.tar.gz`). Upstream calls its
 * Linux builds `ubuntu-*`; we surface them as `linux-*` to keep the
 * Rust matrix in `tauri-plugin-llamacpp-upstream` consistent and to
 * leave room for non-Ubuntu Linux variants if we ever ship them.
 *
 * Whitelist is deliberately narrow: `s390x`, `arm64`, `rocm-7.2-x64`,
 * `openvino-2026.0-x64`, and `vulkan-arm64` are dropped here. Adding
 * one is a one-line edit in this map + a feature detector in the Rust
 * `get_supported_features`.
 */
const LINUX_UPSTREAM_ASSET_BY_BACKEND: Record<string, string> = {
  'linux-cpu-x64': 'ubuntu-x64',
  'linux-vulkan-x64': 'ubuntu-vulkan-x64',
}

const LINUX_BACKEND_BY_UPSTREAM_ASSET: Record<string, string> = Object.fromEntries(
  Object.entries(LINUX_UPSTREAM_ASSET_BY_BACKEND).map(([k, v]) => [v, k])
)

/**
 * Maps the app's stored proxy config (`getProxyConfig`, shaped for the Rust
 * `download_files` command) onto the option shape `@tauri-apps/plugin-http`'s
 * `fetch` expects. Returns `{}` when no proxy is enabled so the caller can
 * spread it unconditionally.
 */
function buildHttpProxyOptions(): {
  proxy?: {
    all: {
      url: string
      basicAuth?: { username: string; password: string }
      noProxy?: string
    }
  }
  danger?: { acceptInvalidCerts?: boolean; acceptInvalidHostnames?: boolean }
} {
  const cfg = getProxyConfig()
  if (!cfg || typeof cfg.url !== 'string' || !cfg.url) {
    return {}
  }

  const proxyConfig: {
    url: string
    basicAuth?: { username: string; password: string }
    noProxy?: string
  } = { url: cfg.url }

  if (typeof cfg.username === 'string' && typeof cfg.password === 'string') {
    proxyConfig.basicAuth = { username: cfg.username, password: cfg.password }
  }
  if (Array.isArray(cfg.no_proxy) && cfg.no_proxy.length > 0) {
    proxyConfig.noProxy = (cfg.no_proxy as string[]).join(',')
  }

  if (cfg.ignore_ssl === true) {
    return {
      proxy: { all: proxyConfig },
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    }
  }
  return { proxy: { all: proxyConfig } }
}

/**
 * Fetches the list of available backend builds from ggml-org/llama.cpp
 * GitHub releases for the current platform/arch.
 *
 * macOS: returns `[]` deliberately — see the ADR "Ship upstream
 * `ggml-org/llama.cpp` as a second macOS provider, no fork". macOS users
 * only get the bundled (re-codesigned) build that ships with each Atomic
 * Chat release.
 *
 * Windows: returns the ggml-org Windows assets (CPU / CUDA 12.4 / CUDA 13.x
 * / Vulkan) so the runtime update flow can fetch fresh builds without
 * shipping a new installer.
 *
 * Linux: returns the ggml-org Ubuntu assets (CPU + Vulkan, x64 only) so
 * the runtime update flow can fetch fresh builds. See the 2026-05-28 ADR
 * *Linux ships only `llamacpp-upstream`*.
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

  if (osType !== 'windows' && osType !== 'linux') {
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
      // Use the Tauri HTTP client (reqwest) so we can (a) honor the
      // user-configured HTTPS proxy from Settings → Proxy and (b) apply a
      // hard `connectTimeout`. The plain WebView `fetch` ignores the app's
      // proxy config, which made this lookup fail on GitHub-restricted
      // networks even when the user had a working proxy set up.
      resp = await tauriFetch(LLAMACPP_RELEASES_API, {
        headers: { 'User-Agent': 'atomic-chat' },
        signal: controller.signal,
        connectTimeout: 15_000,
        ...buildHttpProxyOptions(),
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
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    if (osType === 'windows') {
      // ggml-org Windows assets are zip archives named
      // `llama-{tag}-bin-{backend}.zip` (e.g.
      // `llama-b9284-bin-win-cuda-12.4-x64.zip`). Capture the backend infix.
      const re = new RegExp(`^llama-${escapedTag}-bin-(win-.+)\\.zip$`)

      // Whitelist of ggml-org Windows backend ids we surface to the user.
      // Keeps less-relevant variants (hip-radeon / sycl / opencl-adreno /
      // arm64) hidden until we explicitly support them in the Rust matrix.
      //
      // CUDA-13 minor is intentionally dynamic (`13.x`), because ggml-org
      // periodically bumps the toolkit minor in release assets.
      const isAllowedWindowsBackend = (backendName: string): boolean =>
        backendName === 'win-cpu-x64' ||
        backendName === 'win-cuda-12.4-x64' ||
        /^win-cuda-13\.\d+-x64$/.test(backendName) ||
        backendName === 'win-vulkan-x64'

      const backends: BackendVersion[] = []

      for (const asset of assets) {
        const match = re.exec(asset.name)
        if (!match) continue

        const backendName = match[1]
        if (!isAllowedWindowsBackend(backendName)) continue
        if (!backendName.endsWith(`-${archSuffix}`)) continue

        backends.push({ version: tag, backend: backendName, order: 0 })
      }

      console.info(
        `[fetchRemoteBackends] Found ${backends.length} remote backends for win-${archSuffix}:`,
        backends.map((b) => b.backend)
      )
      return backends
    }

    // Linux: assets are gzipped tarballs named
    // `llama-{tag}-bin-ubuntu-{variant}.tar.gz` (e.g.
    // `llama-b9371-bin-ubuntu-vulkan-x64.tar.gz`). x86_64 only in Phase 1.
    if (archSuffix !== 'x64') {
      console.info(
        `[fetchRemoteBackends] Linux ${archSuffix} not supported in Phase 1; returning no remote backends`
      )
      return []
    }

    const re = new RegExp(`^llama-${escapedTag}-bin-(ubuntu-.+)\\.tar\\.gz$`)
    const backends: BackendVersion[] = []

    for (const asset of assets) {
      const match = re.exec(asset.name)
      if (!match) continue

      const upstreamInfix = match[1]
      const backendName = LINUX_BACKEND_BY_UPSTREAM_ASSET[upstreamInfix]
      if (!backendName) continue

      backends.push({ version: tag, backend: backendName, order: 0 })
    }

    console.info(
      `[fetchRemoteBackends] Found ${backends.length} remote backends for linux-${archSuffix}:`,
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
 *   - Linux: `llama-{tag}-bin-ubuntu-{variant}.tar.gz` (note: internal
 *     backend ids are `linux-*` but upstream filenames carry `ubuntu-*`;
 *     `LINUX_UPSTREAM_ASSET_BY_BACKEND` provides the mapping).
 *
 * macOS / Windows use `.zip`, Linux uses `.tar.gz`. The Tauri `decompress`
 * command handles both formats transparently.
 */
export function getBackendDownloadUrl(
  version: string,
  backend: string
): string {
  version = version.replace(/\uFEFF/g, '').trim()
  backend = backend.replace(/\uFEFF/g, '').trim()
  // Defense-in-depth (ATO-95): ggml-org tags releases as `bXXXX`. The
  // `latest` keyword is only valid for the `/releases/latest` HTML page,
  // NOT for the `/releases/download/<tag>/...` asset path. A literal
  // `latest` here means an unresolved sentinel leaked through — fail loudly
  // instead of silently building a guaranteed-404 URL.
  if (version === 'latest') {
    throw new Error(
      `getBackendDownloadUrl: unresolved 'latest' tag for backend '${backend}'. The latest/<backend> sentinel must be resolved to a concrete release tag before download.`
    )
  }
  const linuxInfix = LINUX_UPSTREAM_ASSET_BY_BACKEND[backend]
  if (linuxInfix) {
    return `${LLAMACPP_DOWNLOAD_BASE}/${version}/llama-${version}-bin-${linuxInfix}.tar.gz`
  }
  return `${LLAMACPP_DOWNLOAD_BASE}/${version}/llama-${version}-bin-${backend}.zip`
}

/**
 * Maps an internal backend id (e.g. `win-cuda-13.4-x64`, `linux-vulkan-x64`)
 * to a short human-friendly variant label used by the "Latest <variant>"
 * dropdown entries. Falls back to the raw id for anything unrecognised.
 */
export function friendlyBackendLabel(backend: string): string {
  const id = backend.replace(/\uFEFF/g, '').trim()
  if (id.endsWith('cpu-x64')) return 'CPU'
  if (id.includes('cuda-13')) return 'CUDA 13'
  if (id.includes('cuda-12')) return 'CUDA 12.4'
  if (id.includes('vulkan')) return 'Vulkan'
  return id
}

/**
 * Maps a Windows CUDA backend variant id (e.g. `win-cuda-13.4-x64`) to
 * the matching cudart asset on the same ggml-org/llama.cpp release.
 *
 * The main `llama-{tag}-bin-win-cuda-{12.4,13.x}-x64.zip` archives ship
 * only the llama-server executable and its direct deps; the CUDA Toolkit
 * runtime DLLs (cudart64_*.dll, cublas64_*.dll, cublasLt64_*.dll, …)
 * live in a sibling `cudart-llama-bin-win-cuda-{12.4,13.x}-x64.zip`.
 * Without those DLLs, `llama-server.exe --list-devices` returns an empty
 * device list on machines that don't have the CUDA Toolkit installed
 * system-wide (GitHub issue AtomicBot-ai/Atomic-Chat#14).
 *
 * ggml-org dropped CUDA 11 release artifacts — the lowest CUDA tier
 * shipped is CUDA 12.4. Hosts whose driver only supports CUDA 11 fall
 * back to the CPU build via runtime driver-version gating.
 */
const WINDOWS_CUDA_BACKEND_RE = /^win-cuda-(12\.4|13\.\d+)-x64$/

function matchWindowsCudaBackend(
  backend: string
): string | null {
  const match = WINDOWS_CUDA_BACKEND_RE.exec(backend.replace(/\uFEFF/g, '').trim())
  if (!match) return null
  return match[1]
}

function buildWindowsCudartArchiveName(cudaToolkitVersion: string): string {
  return `cudart-llama-bin-win-cuda-${cudaToolkitVersion}-x64.zip`
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
  const toolkitVersion = matchWindowsCudaBackend(backend)
  if (!toolkitVersion) return null
  const filename = buildWindowsCudartArchiveName(toolkitVersion)
  const cleanVersion = version.replace(/\uFEFF/g, '').trim()
  return `${LLAMACPP_DOWNLOAD_BASE}/${cleanVersion}/${filename}`
}

/**
 * Returns the cudart filename (without URL) for a Windows CUDA backend,
 * or `null` if the backend is not a Windows CUDA variant.
 */
export function getCudartArchiveName(backend: string): string | null {
  const toolkitVersion = matchWindowsCudaBackend(backend)
  if (!toolkitVersion) return null
  return buildWindowsCudartArchiveName(toolkitVersion)
}

/**
 * Returns the CUDA Toolkit version string (e.g. `13.3`) that the Rust
 * `is_cuda_installed` command expects for a given Windows CUDA backend.
 * `null` for non-CUDA backends.
 */
export function getCudaToolkitVersion(backend: string): string | null {
  return matchWindowsCudaBackend(backend)
}

/**
 * Matches a *minor-less* Windows CUDA family id (e.g. `win-cuda-13-x64`,
 * `win-cuda-12-x64`). These are the family ids the Rust matrix
 * (`determine_supported_backends`) and the TS dropdown `staticVariants`
 * emit — the concrete minor (`13.3`, `12.4`) is only known once the
 * ggml-org release stream is queried (ATO-105/ATO-174).
 */
const WIN_CUDA_FAMILY_RE = /^win-cuda-(\d+)-x64$/

/**
 * The CUDA major (`"13"`, `"12"`) of a minor-less family id, or `null` if
 * `backend` is not a minor-less Windows CUDA family id (concrete ids like
 * `win-cuda-13.3-x64` deliberately return `null` here — they need no
 * family resolution).
 */
export function cudaFamilyMajor(backend: string): string | null {
  const m = WIN_CUDA_FAMILY_RE.exec(backend.replace(/\uFEFF/g, '').trim())
  return m ? m[1] : null
}

/**
 * True when `concrete` (e.g. `win-cuda-13.3-x64`) belongs to the minor-less
 * CUDA family `familyBackend` (e.g. `win-cuda-13-x64`). False for a
 * non-family `familyBackend` or a non-matching major.
 */
export function isConcreteOfCudaFamily(
  familyBackend: string,
  concrete: string
): boolean {
  const major = cudaFamilyMajor(familyBackend)
  if (!major) return false
  return new RegExp(`^win-cuda-${major}\\.\\d+-x64$`).test(
    concrete.replace(/\uFEFF/g, '').trim()
  )
}

/**
 * Resolves a minor-less CUDA family id (`win-cuda-13-x64`) to the newest
 * concrete `<tag>/<backend>` of that major in `remote` (e.g.
 * `b9596/win-cuda-13.3-x64`). Picks the highest minor when ggml-org ships
 * more than one. Returns `null` when `familyBackend` is not a family id or
 * no concrete asset of that major is present.
 */
export function resolveCudaFamilyConcrete(
  familyBackend: string,
  remote: BackendVersion[]
): string | null {
  const major = cudaFamilyMajor(familyBackend)
  if (!major) return null
  const concreteRe = new RegExp(`^win-cuda-${major}\\.(\\d+)-x64$`)
  let best: { version: string; backend: string; minor: number } | null = null
  for (const b of remote) {
    const backendName = b.backend.replace(/\uFEFF/g, '').trim()
    const m = concreteRe.exec(backendName)
    if (!m) continue
    const minor = parseInt(m[1], 10)
    if (!best || minor > best.minor) {
      best = { version: b.version, backend: backendName, minor }
    }
  }
  return best ? `${best.version}/${best.backend}` : null
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
  // CUDA-13 is matched family-wise (ATO-105): ggml-org periodically bumps
  // the toolkit minor (13.1 -> 13.3 -> 13.x) in its release assets, so the
  // supported set carries the minor-less family id `win-cuda-13-x64` (emitted
  // by `determine_supported_backends`) instead of a hardcoded concrete minor.
  // Any concrete `win-cuda-13.<minor>-x64` asset is accepted when the family
  // is supported, and the concrete id (e.g. `win-cuda-13.4-x64`) keeps
  // flowing downstream unchanged so the right asset is downloaded.
  const WIN_CUDA13_CONCRETE_RE = /^win-cuda-13\.\d+-(x64|arm64)$/
  const isSupported = (rawBackend: string, normalizedBackend: string): boolean => {
    if (supportedSet.has(normalizedBackend)) return true
    const m = WIN_CUDA13_CONCRETE_RE.exec(rawBackend)
    if (m) {
      return supportedSet.has(`win-cuda-13-${m[1]}`)
    }
    return false
  }

  const filteredBackends = await Promise.all(
    mergedBackends.map(async (backendInfo) => ({
      backendInfo,
      rawBackend: backendInfo.backend.replace(/\uFEFF/g, '').trim(),
      normalizedBackend: await mapOldBackendToNew(backendInfo.backend),
    }))
  )

  const supportedMergedBackends = filteredBackends
    .filter(({ rawBackend, normalizedBackend }) =>
      isSupported(rawBackend, normalizedBackend)
    )
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

/**
 * Find a working, already-installed backend of the SAME type as `backendType`
 * (e.g. `macos-arm64`), regardless of its release tag. Used as a fallback
 * (ATO-179, AC2) when the model's pinned `version_backend` can't be obtained
 * (download failed / the tag was pruned upstream) but a compatible build is
 * already on disk — so the load degrades to a working backend instead of
 * failing with `BINARY_NOT_FOUND`.
 *
 * "Compatible" is deliberately limited to the identical backend type: every
 * release tag of the same type targets the same platform / GPU variant and is
 * interchangeable. We do NOT cross types here (e.g. cuda → cpu) — that is a
 * feature/perf trade-off that must stay an explicit user choice.
 *
 * Returns the newest (by on-disk mtime, via `order`) matching backend, or
 * `null` when none is installed.
 */
export async function findCompatibleInstalledBackend(
  backendType: string
): Promise<BackendVersion | null> {
  const normalized = backendType.replace(/\uFEFF/g, '').trim()
  const installed = await getLocalInstalledBackends()
  const sameType = installed.filter(
    (b) => b.backend.replace(/\uFEFF/g, '').trim() === normalized
  )
  if (sameType.length === 0) return null
  sameType.sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
  return sameType[0]
}

/**
 * Remove orphan / incomplete backend directories from this provider's
 * backends tree (ATO-179, AC3). An "incomplete" directory is one that exists
 * on disk but carries no `llama-server` executable — e.g. an empty stub left
 * by an interrupted/failed download, which would otherwise be mistaken for a
 * usable backend or block a clean re-download.
 *
 * Scoped strictly to `llamacpp-upstream/backends/` so the shared GGUF model
 * tree and the turboquant `llamacpp` backends are never touched. Best-effort:
 * a failure on any single entry is logged by the caller and does not abort the
 * sweep. Returns the list of removed `<version>/<backend>` identifiers.
 */
export async function cleanupIncompleteBackends(): Promise<string[]> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendsRoot = await joinPath([
    janDataFolderPath,
    'llamacpp-upstream',
    'backends',
  ])

  const removed: string[] = []
  if (!(await fs.existsSync(backendsRoot))) return removed

  const versionDirs: string[] = await fs.readdirSync(backendsRoot)
  for (const version of versionDirs) {
    const versionPath = await joinPath([backendsRoot, version])
    let backendTypes: string[]
    try {
      backendTypes = await fs.readdirSync(versionPath)
    } catch {
      // Not a directory (stray file) — skip; it does not match our layout.
      continue
    }

    for (const backendType of backendTypes) {
      if (await isBackendInstalled(backendType, version)) continue
      const dir = await getBackendDir(backendType, version)
      await fs.rm(dir)
      removed.push(`${version}/${backendType}`)
    }

    // Drop a now-empty version directory.
    try {
      const remaining: string[] = await fs.readdirSync(versionPath)
      if (remaining.length === 0) await fs.rm(versionPath)
    } catch {
      // ignore
    }
  }

  return removed
}

async function _getSupportedFeatures() {
  const sysInfo = await getSystemInfo()
  return await getSupportedFeaturesFromRust(
    sysInfo.os_type,
    sysInfo.cpu.extensions,
    sysInfo.gpus
  )
}
