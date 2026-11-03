/**
 * Setup readiness checks. Pure decision logic, kept out of the extension class
 * so it is testable without a router, a backend install, or Tauri.
 */

export type ReadinessStatus = 'ok' | 'warning'

/**
 * `runtimeUnreachable` means a GPU exists but the engine cannot see it, which
 * points at the driver or runtime. `missingLibrary` is the same symptom with the
 * cause established: the loader named a dependency it could not resolve.
 *
 * `noGpuHardware` is gone: it meant "a GPU build on a machine with no GPU",
 * which the bundled engine cannot be in -- no GPU means no GPU expected, which
 * is simply `ok`.
 */
export type GpuOffloadReason = 'runtimeUnreachable' | 'missingLibrary'

export interface GpuOffloadCheck {
  status: ReadinessStatus
  gpuExpected: boolean
  engineDeviceCount: number
  reason?: GpuOffloadReason
  /** Set only for `missingLibrary`, to drive install advice. */
  missingLibraries?: string[]
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

/**
 * Devices that are not where model layers run: the CPU itself and the BLAS
 * library that accelerates its matrix maths. The engine lists them next to the
 * GPUs (on macOS `BLAS` comes before `MTL0`), so they only name the backend
 * when nothing else was enumerated.
 */
const HOST_DEVICES: Record<string, true> = { cpu: true, blas: true }

/** `Vulkan0` -> `vulkan`, Metal's `MTL0` -> `metal`; empty ids drop out. */
function deviceNames(deviceIds: string[]): string[] {
  return deviceIds
    .map((id) => id.trim().replace(/\d+$/, '').toLowerCase())
    .filter((name) => name !== '')
    .map((name) => (name === 'mtl' ? 'metal' : name))
}

/**
 * How many of the engine's devices are not the host. This is the count the GPU
 * offload check compares with the hardware, so it excludes the same devices
 * `backendFromDeviceIds` skips: an engine that lists only `BLAS` has not loaded
 * a GPU.
 */
export function countAcceleratorDevices(deviceIds: string[]): number {
  return deviceNames(deviceIds).filter((name) => HOST_DEVICES[name] !== true)
    .length
}

/**
 * The backend a device id came from, e.g. `Vulkan0` -> `vulkan`.
 *
 * Observed rather than declared: with the engine bundled at a pinned version
 * there is no backend *setting* to read, and the device the engine actually
 * enumerated is a stronger signal than a configured name ever was -- a
 * configured `cuda` told us nothing about whether CUDA loaded.
 *
 * The first accelerator wins; a host device (`BLAS`, `CPU`) is named only when
 * there is no accelerator. Metal's own id is `MTL`, which is named `metal`.
 */
export function backendFromDeviceIds(deviceIds: string[]): string {
  const names = deviceNames(deviceIds)
  return names.find((name) => HOST_DEVICES[name] !== true) ?? names[0] ?? ''
}

/**
 * A GPU present in hardware but absent from the engine's device list means
 * layers silently run on the host: llama.cpp's layer fit puts everything on the
 * CPU and the engine still reports healthy. Comparing the two counts is the
 * only signal that offload never happened.
 */
export function evaluateGpuOffload(input: {
  engineDeviceCount: number
  hardwareGpuCount: number
}): GpuOffloadCheck {
  const { engineDeviceCount, hardwareGpuCount } = input
  // "Expected" is now a property of the machine, not of a chosen build: the
  // shipped engine offloads wherever it can.
  const gpuExpected = hardwareGpuCount > 0

  if (!gpuExpected || engineDeviceCount > 0) {
    return { status: 'ok', gpuExpected, engineDeviceCount }
  }

  return {
    status: 'warning',
    gpuExpected,
    engineDeviceCount,
    reason: 'runtimeUnreachable',
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
