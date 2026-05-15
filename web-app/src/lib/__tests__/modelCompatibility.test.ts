import { describe, it, expect } from 'vitest'
import type { HardwareData } from '@/hooks/useHardware'
import {
  DEFAULT_CTX_LENGTH,
  estimateKvCacheBytes,
  estimateModelFit,
  isAppleSilicon,
  parseFileSize,
} from '../modelCompatibility'

const GB = 1024 ** 3

const baseHardware = (overrides: Partial<HardwareData> = {}): HardwareData => ({
  cpu: { arch: 'x86_64', core_count: 8, extensions: [], name: 'CPU', usage: 0 },
  gpus: [],
  os_type: 'linux',
  os_name: 'linux',
  total_memory: 16 * 1024,
  ...overrides,
})

const appleSilicon = (totalMemoryGib: number): HardwareData =>
  baseHardware({
    cpu: { arch: 'aarch64', core_count: 10, extensions: [], name: 'M2', usage: 0 },
    os_type: 'macos',
    total_memory: totalMemoryGib * 1024,
  })

const withDiscreteGpu = (
  ramGib: number,
  vramGib: number
): HardwareData =>
  baseHardware({
    total_memory: ramGib * 1024,
    gpus: [
      {
        name: 'GPU',
        total_memory: vramGib * 1024,
        vendor: 'nvidia',
        uuid: '0',
        driver_version: '',
        nvidia_info: { index: 0, compute_capability: '8.0' },
        vulkan_info: {
          index: 0,
          device_id: 0,
          device_type: 'discrete',
          api_version: '',
        },
      },
    ],
  })

describe('parseFileSize', () => {
  it('parses common decimal units', () => {
    expect(parseFileSize('4.7 GB')).toBeCloseTo(4.7 * 1000 ** 3)
    expect(parseFileSize('158 MB')).toBeCloseTo(158 * 1000 ** 2)
    expect(parseFileSize('2.5GB')).toBeCloseTo(2.5 * 1000 ** 3)
  })

  it('parses binary units distinctly from decimal', () => {
    expect(parseFileSize('1 GiB')).toBe(1024 ** 3)
    expect(parseFileSize('1 GB')).toBe(1000 ** 3)
  })

  it('returns null for unparseable input', () => {
    expect(parseFileSize('')).toBeNull()
    expect(parseFileSize(undefined)).toBeNull()
    expect(parseFileSize(null)).toBeNull()
    expect(parseFileSize('not a size')).toBeNull()
    expect(parseFileSize('4.7 ZB')).toBeNull()
  })

  it('accepts numbers as bytes', () => {
    expect(parseFileSize(5_000_000)).toBe(5_000_000)
    expect(parseFileSize(-1)).toBeNull()
  })
})

describe('estimateKvCacheBytes', () => {
  it('scales linearly with context length', () => {
    const base = estimateKvCacheBytes(10 * GB, 4096)
    expect(estimateKvCacheBytes(10 * GB, 8192)).toBeCloseTo(base * 2)
    expect(estimateKvCacheBytes(10 * GB, 2048)).toBeCloseTo(base * 0.5)
  })

  it('uses 10% of file size at the baseline context', () => {
    expect(estimateKvCacheBytes(10 * GB, 4096)).toBeCloseTo(GB)
  })

  it('falls back to default ctx when ctx is non-positive', () => {
    expect(estimateKvCacheBytes(10 * GB, 0)).toBeCloseTo(
      estimateKvCacheBytes(10 * GB, DEFAULT_CTX_LENGTH)
    )
  })

  it('returns 0 for invalid file size', () => {
    expect(estimateKvCacheBytes(0)).toBe(0)
    expect(estimateKvCacheBytes(-1)).toBe(0)
    expect(estimateKvCacheBytes(NaN)).toBe(0)
  })
})

describe('isAppleSilicon', () => {
  it('detects macOS + aarch64 + no discrete GPU', () => {
    expect(isAppleSilicon(appleSilicon(16))).toBe(true)
  })

  it('rejects when a discrete GPU is present', () => {
    const hw = appleSilicon(16)
    expect(isAppleSilicon({ ...hw, gpus: withDiscreteGpu(16, 8).gpus })).toBe(false)
  })

  it('rejects Intel Macs', () => {
    expect(
      isAppleSilicon({ ...appleSilicon(16), cpu: { ...appleSilicon(16).cpu, arch: 'x86_64' } })
    ).toBe(false)
  })
})

describe('estimateModelFit', () => {
  it('returns unknown when file size cannot be determined', () => {
    expect(estimateModelFit(null, DEFAULT_CTX_LENGTH, appleSilicon(16))).toBe('unknown')
    expect(estimateModelFit(0, DEFAULT_CTX_LENGTH, appleSilicon(16))).toBe('unknown')
  })

  it('returns unknown when hardware has not been probed', () => {
    expect(
      estimateModelFit(4 * GB, DEFAULT_CTX_LENGTH, baseHardware({ total_memory: 0 }))
    ).toBe('unknown')
  })

  describe('apple silicon', () => {
    it('greens a small model on a 16 GiB M-series', () => {
      expect(estimateModelFit(4 * GB, DEFAULT_CTX_LENGTH, appleSilicon(16))).toBe('green')
    })

    it('reds a model that exceeds usable unified memory', () => {
      expect(estimateModelFit(13 * GB, DEFAULT_CTX_LENGTH, appleSilicon(16))).toBe('red')
    })

    it('yellows a model that fits but leaves <15% headroom', () => {
      // 16 GiB → usable ≈ 11.9 GiB; comfortable threshold ≈ 10.1 GiB.
      // 9.5 GiB file × 1.2 (ctx overhead) ≈ 11.4 GiB required → YELLOW band.
      expect(estimateModelFit(9.5 * GB, DEFAULT_CTX_LENGTH, appleSilicon(16))).toBe('yellow')
    })
  })

  describe('discrete GPU', () => {
    it('greens a model that fits entirely in usable VRAM', () => {
      expect(
        estimateModelFit(4 * GB, DEFAULT_CTX_LENGTH, withDiscreteGpu(32, 16))
      ).toBe('green')
    })

    it('yellows a model that spills from VRAM into system RAM', () => {
      expect(
        estimateModelFit(10 * GB, DEFAULT_CTX_LENGTH, withDiscreteGpu(32, 8))
      ).toBe('yellow')
    })

    it('reds a model larger than combined usable RAM+VRAM', () => {
      expect(
        estimateModelFit(40 * GB, DEFAULT_CTX_LENGTH, withDiscreteGpu(16, 8))
      ).toBe('red')
    })
  })

  describe('CPU only (no GPU)', () => {
    it('greens a model that fits in usable RAM', () => {
      expect(
        estimateModelFit(8 * GB, DEFAULT_CTX_LENGTH, baseHardware({ total_memory: 32 * 1024 }))
      ).toBe('green')
    })

    it('reds a model larger than usable RAM', () => {
      expect(
        estimateModelFit(20 * GB, DEFAULT_CTX_LENGTH, baseHardware({ total_memory: 16 * 1024 }))
      ).toBe('red')
    })
  })

  it('respects context length when computing required memory', () => {
    const hw = appleSilicon(16)
    expect(estimateModelFit(9 * GB, 2048, hw)).toBe('green')
    expect(estimateModelFit(9 * GB, 32768, hw)).not.toBe('green')
  })
})
