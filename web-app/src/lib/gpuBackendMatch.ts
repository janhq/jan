/**
 * Cross-checks detected GPU hardware against the llama.cpp backend that is
 * actually installed.
 *
 * The engine's own readiness probe can only answer "does this GPU build see a
 * device". It is silent in the inverse case -- a machine with a discrete GPU
 * running a CPU-only build reports a healthy "running on CPU", which is
 * indistinguishable from a machine that has no GPU at all. That case is the
 * most expensive one to leave undetected, so it is derived here from the two
 * facts the setup checklist already holds.
 */

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'unknown'

export type BackendGpuFamily =
  | 'cuda'
  | 'vulkan'
  | 'hip'
  | 'metal'
  | 'cpu'
  | 'unknown'

export interface DetectedGpu {
  name?: string
  vendor?: string
  total_memory?: number
  driver_version?: string
}

export type BackendGpuMatch =
  /** The installed backend can drive at least one detected GPU. */
  | { kind: 'ok' }
  /** No backend is selected yet, so nothing can be concluded. */
  | { kind: 'unknown' }
  /** No GPU present, and a CPU build is the correct choice. */
  | { kind: 'noGpu' }
  /** A GPU is present but the installed build is CPU-only. */
  | { kind: 'gpuUnused'; gpus: DetectedGpu[] }
  /** A GPU build is installed that none of the detected GPUs can run. */
  | { kind: 'vendorMismatch'; family: BackendGpuFamily; gpus: DetectedGpu[] }

const VENDOR_PATTERNS: [GpuVendor, RegExp][] = [
  ['nvidia', /nvidia|geforce|\b[gr]tx\b|quadro|tesla/i],
  ['amd', /\bamd\b|radeon|\bati\b/i],
  ['intel', /intel|\barc\b/i],
]

export function classifyVendor(vendor: string | undefined): GpuVendor {
  if (!vendor) return 'unknown'
  for (const [known, pattern] of VENDOR_PATTERNS) {
    if (pattern.test(vendor)) return known
  }
  return 'unknown'
}

/**
 * Vendor is reported by the PCI id, which comes back as `Unknown (vendor_id: N)`
 * for anything outside the three known ids. Falling back to the device name
 * keeps a rebranded OEM card from being misread as a foreign vendor.
 */
export function gpuVendor(gpu: DetectedGpu): GpuVendor {
  const byVendor = classifyVendor(gpu.vendor)
  if (byVendor !== 'unknown') return byVendor
  return classifyVendor(gpu.name)
}

const FAMILY_MARKERS: [BackendGpuFamily, RegExp][] = [
  ['cuda', /cuda|\bcu\d/i],
  ['vulkan', /vulkan/i],
  ['hip', /\bhip\b|rocm/i],
]

/**
 * An absent backend name means the engine has not finished picking one yet -- on
 * a fresh install that takes a backend download. It must not read as "CPU-only
 * build", which is what made a CUDA install report an idle GPU.
 */
export function backendGpuFamily(backend: string | undefined): BackendGpuFamily {
  const name = backend?.trim()
  if (!name || name === 'none') return 'unknown'
  for (const [family, pattern] of FAMILY_MARKERS) {
    if (pattern.test(name)) return family
  }
  // Metal is compiled into every macOS build and needs no separate runtime, so
  // a macOS backend name with no GPU marker still means GPU-capable.
  if (/^mac|darwin/i.test(name)) return 'metal'
  return 'cpu'
}

/** Vulkan is driver-provided on every modern GPU; CUDA and HIP are vendor-locked. */
export function vendorSupportsFamily(
  vendor: GpuVendor,
  family: BackendGpuFamily
): boolean {
  switch (family) {
    case 'cuda':
      return vendor === 'nvidia'
    case 'hip':
      return vendor === 'amd'
    case 'vulkan':
    case 'metal':
      return true
    case 'cpu':
    case 'unknown':
      return false
  }
}

export function evaluateBackendGpuMatch(
  gpus: DetectedGpu[] | undefined,
  backend: string | undefined
): BackendGpuMatch {
  const detected = gpus ?? []
  const family = backendGpuFamily(backend)

  if (family === 'unknown') return { kind: 'unknown' }

  if (family === 'metal') return { kind: 'ok' }

  if (family === 'cpu') {
    return detected.length > 0
      ? { kind: 'gpuUnused', gpus: detected }
      : { kind: 'noGpu' }
  }

  const vendors = detected.map(gpuVendor)
  if (vendors.some((vendor) => vendorSupportsFamily(vendor, family))) {
    return { kind: 'ok' }
  }

  // Claiming a mismatch requires knowing what the hardware actually is. With
  // no GPU detected, or none whose vendor could be identified, the engine's own
  // verdict is the better evidence -- a false mismatch warning would send users
  // to reinstall a backend that works.
  if (vendors.every((vendor) => vendor === 'unknown')) {
    return { kind: 'ok' }
  }

  return { kind: 'vendorMismatch', family, gpus: detected }
}

/** `NVIDIA GeForce RTX 4090 (24 GB)`, joined for a one-line checklist row. */
export function describeGpus(gpus: DetectedGpu[]): string {
  return gpus
    .map((gpu) => {
      const name = gpu.name?.trim() || gpu.vendor?.trim() || ''
      const gib = gpu.total_memory ? Math.round(gpu.total_memory / 1024) : 0
      if (!name) return gib ? `${gib} GB` : ''
      return gib ? `${name} (${gib} GB)` : name
    })
    .filter(Boolean)
    .join(', ')
}
