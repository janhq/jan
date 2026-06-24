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
} from '../../../src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index'

// The TurboQuant provider (this extension) points at our llama.cpp fork
// AtomicBot-ai/atomic-llama-cpp-turboquant. Unlike the upstream provider
// (a single ggml-org release), the fork ships *each* backend variant in its
// OWN release with its OWN tag (all on the same SHA), so a /releases/latest
// lookup is useless and a /releases scan would hammer the rate-limited
// api.github.com. Instead the backend *index* (which variants exist + at
// which tag) is resolved from a static manifest in our atomic-chat-conf repo,
// served via raw.githubusercontent.com (no per-IP rate limit) — the same
// channel llamacpp-upstream uses (ADR 2026-06-17). The only shape difference
// from the upstream manifest is that each turboquant entry carries its own
// `tag`. The backend *archives* themselves are still downloaded from the
// GitHub releases CDN via LLAMACPP_DOWNLOAD_BASE.
const TURBOQUANT_BACKEND_MANIFEST_URL =
  'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/turboquant-manifest.json'
const LLAMACPP_DOWNLOAD_BASE =
  'https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant/releases/download'
const MANIFEST_FETCH_TIMEOUT_MS = 8_000

interface TurboquantManifestEntry {
  id: string
  tag: string
  asset: string
}

export async function getLocalInstalledBackends(): Promise<BackendVersion[]> {
  const janDataFolderPath = await getJanDataFolderPath()
  const backendDir = await joinPath([janDataFolderPath, 'llamacpp', 'backends'])
  return await getLocalInstalledBackendsInternal(backendDir)
}
// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_version>/<backend_type>

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

async function fetchManifestWithTimeout(useProxy: boolean): Promise<Response> {
  // Guard each request with a hard Promise timeout because some
  // `@tauri-apps/plugin-http` code paths may ignore AbortSignal under certain
  // network/proxy failures.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const request = tauriFetch(TURBOQUANT_BACKEND_MANIFEST_URL, {
    headers: { 'User-Agent': 'atomic-chat' },
    connectTimeout: MANIFEST_FETCH_TIMEOUT_MS,
    ...(useProxy ? buildHttpProxyOptions() : {}),
  })
  const timeout = new Promise<Response>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(`Manifest fetch timed out after ${MANIFEST_FETCH_TIMEOUT_MS}ms`)
      )
    }, MANIFEST_FETCH_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function fetchManifestWithWebFetch(): Promise<Response> {
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  // `globalThis.fetch` (NOT bare `fetch`) is mandatory here: the production
  // rolldown build injects `fetch` -> `@tauri-apps/plugin-http`'s fetch (see
  // rolldown.config.mjs), so a bare `fetch` call would silently route through
  // plugin-http too. `globalThis.fetch` is the real WebView fetch, which the
  // registry loaders prove resolves reliably against raw.githubusercontent.com.
  const request = globalThis.fetch(TURBOQUANT_BACKEND_MANIFEST_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'atomic-chat' },
    signal: controller.signal,
  })
  const timeout = new Promise<Response>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(
        new Error(
          `Manifest web fetch timed out after ${MANIFEST_FETCH_TIMEOUT_MS}ms`
        )
      )
    }, MANIFEST_FETCH_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function fetchManifestWithFallbacks(): Promise<Response> {
  // WebView fetch is the proven-reliable primary path; the two plugin-http
  // variants are fallbacks for air-gapped/corporate-proxy setups where the
  // WebView fetch is intercepted but the Rust HTTP client is allowed through.
  const attempts: Array<{ label: string; runner: () => Promise<Response> }> = [
    { label: 'webview fetch', runner: () => fetchManifestWithWebFetch() },
    {
      label: 'proxy-aware tauri fetch',
      runner: () => fetchManifestWithTimeout(true),
    },
    { label: 'direct tauri fetch', runner: () => fetchManifestWithTimeout(false) },
  ]

  const wrapped = attempts.map(({ label, runner }) =>
    runner()
      .then((resp) => ({ label, resp }))
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`${label}: ${reason}`)
      })
  )

  try {
    const winner = await Promise.any(wrapped)
    console.info(
      `[fetchRemoteBackends] TurboQuant manifest fetch succeeded via ${winner.label}`
    )
    return winner.resp
  } catch (aggregateErr) {
    const reasons =
      aggregateErr instanceof AggregateError
        ? aggregateErr.errors
            .map((e) => (e instanceof Error ? e.message : String(e)))
            .join(' | ')
        : aggregateErr instanceof Error
          ? aggregateErr.message
          : String(aggregateErr)
    throw new Error(`All manifest fetch attempts failed: ${reasons}`)
  }
}

/**
 * Resolves the list of available TurboQuant backend builds from the static
 * manifest in atomic-chat-conf, filtered to the hardware-supported ids for
 * the current OS/arch.
 *
 * macOS uses the bundled (re-codesigned) build that ships with each release;
 * its `macos-arm64` id may be present in the manifest but the bundled flow
 * (configureBackends) owns it, so a network failure here is harmless.
 *
 * Each entry carries its own release `tag` (the variants live in separate
 * releases), surfaced as `BackendVersion.version`. Returns `[]` on any
 * failure so the app can still work offline with only bundled/local backends.
 */
export async function fetchRemoteBackends(): Promise<BackendVersion[]> {
  const sysInfo = await getSystemInfo()
  const osType = sysInfo.os_type
  const arch = sysInfo.cpu.arch

  if (osType !== 'windows' && osType !== 'linux') {
    return []
  }

  // The supported-id set already encodes OS/arch + hardware features, so we
  // keep only manifest entries the current machine can actually run.
  const rawFeatures = await _getSupportedFeatures()
  const features = normalizeFeatures(rawFeatures)
  const supportedBackends = await determineSupportedBackends(
    osType,
    arch,
    features
  )
  const supportedSet = new Set(supportedBackends)

  try {
    console.info(
      `[fetchRemoteBackends] Fetching TurboQuant manifest ${TURBOQUANT_BACKEND_MANIFEST_URL}...`
    )
    const resp = await fetchManifestWithFallbacks()
    if (!resp.ok) {
      console.warn(
        `[fetchRemoteBackends] TurboQuant manifest returned ${resp.status}, using local backends only`
      )
      return []
    }

    const manifest = await resp.json()
    const entries: TurboquantManifestEntry[] = Array.isArray(manifest?.backends)
      ? manifest.backends
      : []

    const backends: BackendVersion[] = []
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        typeof entry.tag !== 'string'
      ) {
        continue
      }
      if (!supportedSet.has(entry.id)) continue
      backends.push({ version: entry.tag, backend: entry.id, order: 0 })
    }

    console.info(
      `[fetchRemoteBackends] Found ${backends.length} supported TurboQuant backends for ${osType}/${arch}:`,
      backends.map((b) => `${b.version}/${b.backend}`)
    )
    return backends
  } catch (err) {
    console.warn(
      '[fetchRemoteBackends] Failed to fetch TurboQuant manifest:',
      err
    )
    return []
  }
}

/**
 * Builds the download URL for a specific TurboQuant backend from the
 * AtomicBot-ai/atomic-llama-cpp-turboquant releases CDN.
 *
 * `version` is the per-backend release tag carried from the manifest (each
 * variant lives in its own release), so the scattered-release URL is exact.
 * Windows variants are `.zip`, Linux/macOS are `.tar.gz`. CUDA zips already
 * bundle the cudart/cublas DLLs inline — no separate cudart companion.
 */
export function getBackendDownloadUrl(
  version: string,
  backend: string
): string {
  version = version.replace(/\uFEFF/g, '').trim()
  backend = backend.replace(/\uFEFF/g, '').trim()
  const ext = IS_WINDOWS ? 'zip' : 'tar.gz'
  return `${LLAMACPP_DOWNLOAD_BASE}/${version}/llama-turboquant-${backend}.${ext}`
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

  // Windows and Linux use the hardware-gated TurboQuant backend matrix. macOS
  // stays on its bundled flow (configureBackends owns the single macos-arm64
  // build), so leave it unfiltered.
  if (osType !== 'windows' && osType !== 'linux') {
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
    `[listSupportedBackends] ${osType} filtered backends:`,
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
