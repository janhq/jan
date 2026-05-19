import type { HardwareData } from '@/hooks/useHardware'
import type { CatalogModel } from '@/services/models/types'

export type FitTier = 'green' | 'yellow' | 'red' | 'unknown'

export const DEFAULT_CTX_LENGTH = 8192

const KV_HEURISTIC_RATIO = 0.1
const KV_BASELINE_CTX = 4096

const DISCRETE_RESERVE_BYTES = 2_288_490_189
const APPLE_SILICON_FIXED_OVERHEAD = 2_684_354_560
const APPLE_SILICON_VARIABLE_RATIO = 0.1
const APPLE_SILICON_COMFORTABLE_RATIO = 0.85

const MIB = 1024 * 1024
const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1000,
  kib: 1024,
  mb: 1000 ** 2,
  mib: 1024 ** 2,
  gb: 1000 ** 3,
  gib: 1024 ** 3,
  tb: 1000 ** 4,
  tib: 1024 ** 4,
}

export function parseFileSize(input?: string | number | null): number | null {
  if (input == null) return null
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? input : null
  }
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/)
  if (!match) return null
  const value = parseFloat(match[1])
  if (!Number.isFinite(value) || value < 0) return null
  const unitKey = (match[2] || 'b').toLowerCase()
  const multiplier = UNIT_BYTES[unitKey]
  if (multiplier === undefined) return null
  return value * multiplier
}

// MLX models are split across multiple safetensors shards; sum them to get
// the on-device weight footprint that should be fed into estimateModelFit.
export function sumMlxModelBytes(model: CatalogModel): number {
  return (model.safetensors_files ?? []).reduce(
    (acc, f) => acc + (parseFileSize(f.file_size) ?? 0),
    0
  )
}

export function estimateKvCacheBytes(
  fileSizeBytes: number,
  ctxLength: number = DEFAULT_CTX_LENGTH
): number {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return 0
  const ctx = ctxLength > 0 ? ctxLength : DEFAULT_CTX_LENGTH
  return fileSizeBytes * KV_HEURISTIC_RATIO * (ctx / KV_BASELINE_CTX)
}

export function isAppleSilicon(hardware: HardwareData): boolean {
  return (
    hardware.os_type === 'macos' &&
    hardware.cpu.arch === 'aarch64' &&
    hardware.gpus.length === 0
  )
}

function totalRamBytes(hardware: HardwareData): number {
  return (hardware.total_memory || 0) * MIB
}

function totalVramBytes(hardware: HardwareData): number {
  return hardware.gpus.reduce((sum, g) => sum + (g.total_memory || 0) * MIB, 0)
}

function hardwareReady(hardware: HardwareData): boolean {
  return totalRamBytes(hardware) > 0
}

export function estimateModelFit(
  fileSizeBytes: number | null,
  ctxLength: number,
  hardware: HardwareData
): FitTier {
  if (
    fileSizeBytes == null ||
    !Number.isFinite(fileSizeBytes) ||
    fileSizeBytes <= 0
  ) {
    return 'unknown'
  }
  if (!hardwareReady(hardware)) return 'unknown'

  const required = fileSizeBytes + estimateKvCacheBytes(fileSizeBytes, ctxLength)

  if (isAppleSilicon(hardware)) {
    const total = totalRamBytes(hardware)
    const variableOverhead = total * APPLE_SILICON_VARIABLE_RATIO
    const usable = Math.max(0, total - APPLE_SILICON_FIXED_OVERHEAD - variableOverhead)
    if (required > usable) return 'red'
    return required <= usable * APPLE_SILICON_COMFORTABLE_RATIO ? 'green' : 'yellow'
  }

  const ram = totalRamBytes(hardware)
  const vram = totalVramBytes(hardware)
  const hasDiscreteGpu = vram > 0

  if (!hasDiscreteGpu) {
    const usable = Math.max(0, ram - DISCRETE_RESERVE_BYTES)
    return required <= usable ? 'green' : 'red'
  }

  const usableVram = Math.max(0, vram - DISCRETE_RESERVE_BYTES)
  const usableRam = Math.max(0, ram - DISCRETE_RESERVE_BYTES)
  const usableTotal = usableRam + usableVram

  if (required > usableTotal) return 'red'
  if (required <= usableVram) return 'green'
  return 'yellow'
}
