/**
 * Setup readiness checks. Pure decision logic, kept out of the extension class
 * so it is testable without a router, a backend install, or Tauri.
 */

export type ReadinessStatus = 'ok' | 'warning'

/**
 * `noGpuHardware` means a GPU build is installed on a machine with no GPU.
 * `runtimeUnreachable` means a GPU exists but the engine cannot see it, which
 * points at the driver or runtime rather than the variant choice.
 * `missingLibrary` is the same symptom with the cause established: the loader
 * named a dependency it could not resolve.
 */
export type GpuOffloadReason =
  | 'noGpuHardware'
  | 'runtimeUnreachable'
  | 'missingLibrary'

export interface GpuOffloadCheck {
  status: ReadinessStatus
  gpuExpected: boolean
  engineDeviceCount: number
  reason?: GpuOffloadReason
  /** Set only for `missingLibrary`, to drive install advice. */
  missingLibraries?: string[]
}

/**
 * Whether a backend has been selected. Nothing downstream of the router can be
 * probed until it has: on a fresh install this stays false through a catalog
 * fetch and a backend download, so a probe answered during that window reports
 * an absence of setup rather than a defect.
 */
export function isBackendConfigured(
  versionBackend: string | undefined | null
): boolean {
  const value = (versionBackend ?? '').trim()
  if (value === '' || value === 'none' || !value.includes('/')) return false
  const [version, backend] = value.split('/')
  return Boolean(version && backend)
}

export type EmbeddingVectorProblem =
  | 'missing'
  | 'empty'
  | 'nonFinite'
  | 'degenerate'

export interface EmbeddingVectorCheck {
  ok: boolean
  dimension: number
  problem?: EmbeddingVectorProblem
}

// Substrings of a backend variant id that mean layers are meant to run on a
// GPU. Metal is excluded: it is implicit on Apple Silicon and always present,
// so a macOS build can never be "a GPU build that found no GPU".
const GPU_BACKEND_MARKERS = ['cuda', 'vulkan', 'hip']

export function backendImpliesGpu(backend: string): boolean {
  const lower = (backend ?? '').toLowerCase()
  return GPU_BACKEND_MARKERS.some((marker) => lower.includes(marker))
}

/**
 * A GPU backend that starts cleanly but sees no devices falls back to CPU
 * silently: llama.cpp's layer fit puts everything on the host and the router
 * still reports healthy. Comparing the engine's own device list against the
 * variant is the only way to catch it.
 */
export function evaluateGpuOffload(input: {
  backend: string
  engineDeviceCount: number
  hardwareGpuCount: number
}): GpuOffloadCheck {
  const { backend, engineDeviceCount, hardwareGpuCount } = input
  const gpuExpected = backendImpliesGpu(backend)

  if (!gpuExpected || engineDeviceCount > 0) {
    return { status: 'ok', gpuExpected, engineDeviceCount }
  }

  return {
    status: 'warning',
    gpuExpected,
    engineDeviceCount,
    reason: hardwareGpuCount > 0 ? 'runtimeUnreachable' : 'noGpuHardware',
  }
}

/**
 * Validates a probe embedding before anything is persisted. Mirrors the checks
 * the vector-db plugin applies at insert time, so a broken embedder surfaces
 * during setup instead of on the user's first attachment.
 */
export function evaluateEmbeddingVector(
  vector: unknown
): EmbeddingVectorCheck {
  if (!Array.isArray(vector)) {
    return { ok: false, dimension: 0, problem: 'missing' }
  }
  if (vector.length === 0) {
    return { ok: false, dimension: 0, problem: 'empty' }
  }

  const dimension = vector.length
  const hasInvalid = vector.some(
    (value) => typeof value !== 'number' || !Number.isFinite(value)
  )
  if (hasInvalid) {
    return { ok: false, dimension, problem: 'nonFinite' }
  }

  // Cosine similarity divides by the vector norm, so an all-zero embedding
  // makes every score NaN rather than merely inaccurate.
  if (vector.every((value) => value === 0)) {
    return { ok: false, dimension, problem: 'degenerate' }
  }

  return { ok: true, dimension }
}
