import { describe, expect, it } from 'vitest'
import {
  backendGpuFamily,
  classifyVendor,
  describeGpus,
  evaluateBackendGpuMatch,
  gpuVendor,
  vendorSupportsFamily,
  type DetectedGpu,
} from '../gpuBackendMatch'

const nvidia: DetectedGpu = {
  name: 'NVIDIA GeForce RTX 4090',
  vendor: 'NVIDIA',
  total_memory: 24576,
  driver_version: '550.54.14',
}
const amd: DetectedGpu = {
  name: 'AMD Radeon RX 7900 XTX',
  vendor: 'AMD',
  total_memory: 24576,
}
const intel: DetectedGpu = {
  name: 'Intel Iris Xe Graphics',
  vendor: 'Intel',
  total_memory: 2048,
}

describe('classifyVendor', () => {
  it('maps the vendor strings the hardware plugin emits', () => {
    expect(classifyVendor('NVIDIA')).toBe('nvidia')
    expect(classifyVendor('AMD')).toBe('amd')
    expect(classifyVendor('Intel')).toBe('intel')
  })

  it('treats an unrecognised PCI vendor id as unknown', () => {
    expect(classifyVendor('Unknown (vendor_id: 5140)')).toBe('unknown')
    expect(classifyVendor(undefined)).toBe('unknown')
    expect(classifyVendor('')).toBe('unknown')
  })
})

describe('gpuVendor', () => {
  it('falls back to the device name when the vendor id is unknown', () => {
    expect(
      gpuVendor({ vendor: 'Unknown (vendor_id: 5140)', name: 'Radeon Pro W6800' })
    ).toBe('amd')
  })

  it('prefers the vendor id over the name', () => {
    expect(gpuVendor({ vendor: 'NVIDIA', name: 'Generic Display' })).toBe(
      'nvidia'
    )
  })

  it('stays unknown when neither field is recognisable', () => {
    expect(gpuVendor({ vendor: 'Unknown (vendor_id: 1)', name: 'GPU' })).toBe(
      'unknown'
    )
  })

  // Device names frequently omit the brand: `RTX 4070`, not `NVIDIA RTX 4070`.
  it('recognises bare NVIDIA product lines by name', () => {
    expect(gpuVendor({ name: 'RTX 4070' })).toBe('nvidia')
    expect(gpuVendor({ name: 'GTX 1660 Ti' })).toBe('nvidia')
  })
})

describe('backendGpuFamily', () => {
  it('recognises the backend asset names Jan ships', () => {
    expect(backendGpuFamily('linux-cuda-12-common_cpus-x64')).toBe('cuda')
    expect(backendGpuFamily('win-cuda-13-common_cpus-x64')).toBe('cuda')
    expect(backendGpuFamily('linux-vulkan-common_cpus-x64')).toBe('vulkan')
    expect(backendGpuFamily('win-hip-common_cpus-x64')).toBe('hip')
    expect(backendGpuFamily('linux-common_cpus-x64')).toBe('cpu')
    expect(backendGpuFamily('win-arm64')).toBe('cpu')
  })

  it('treats macOS builds as GPU-capable through Metal', () => {
    expect(backendGpuFamily('macos-arm64')).toBe('metal')
    expect(backendGpuFamily('macos-x64')).toBe('metal')
  })

  it('recognises the short cuda category names', () => {
    expect(backendGpuFamily('cuda-cu13.0')).toBe('cuda')
  })

  // An unnamed backend means the engine has not picked one yet. Reading it as
  // "CPU-only build" made a CUDA install report an idle GPU.
  it('reports an unselected backend as unknown, not cpu', () => {
    expect(backendGpuFamily('')).toBe('unknown')
    expect(backendGpuFamily('   ')).toBe('unknown')
    expect(backendGpuFamily(undefined)).toBe('unknown')
    expect(backendGpuFamily('none')).toBe('unknown')
  })
})

describe('vendorSupportsFamily', () => {
  it('locks cuda to nvidia and hip to amd', () => {
    expect(vendorSupportsFamily('nvidia', 'cuda')).toBe(true)
    expect(vendorSupportsFamily('amd', 'cuda')).toBe(false)
    expect(vendorSupportsFamily('amd', 'hip')).toBe(true)
    expect(vendorSupportsFamily('nvidia', 'hip')).toBe(false)
  })

  it('accepts any GPU for vulkan', () => {
    for (const vendor of ['nvidia', 'amd', 'intel', 'unknown'] as const) {
      expect(vendorSupportsFamily(vendor, 'vulkan'), vendor).toBe(true)
    }
  })

  it('never satisfies a cpu build', () => {
    expect(vendorSupportsFamily('nvidia', 'cpu')).toBe(false)
  })
})

describe('evaluateBackendGpuMatch', () => {
  it('is ok when the backend family matches a detected GPU', () => {
    expect(
      evaluateBackendGpuMatch([nvidia], 'linux-cuda-12-common_cpus-x64')
    ).toEqual({ kind: 'ok' })
    expect(
      evaluateBackendGpuMatch([amd], 'linux-hip-common_cpus-x64')
    ).toEqual({ kind: 'ok' })
    expect(
      evaluateBackendGpuMatch([intel], 'linux-vulkan-common_cpus-x64')
    ).toEqual({ kind: 'ok' })
  })

  it('reports noGpu for a CPU build on a machine with no GPU', () => {
    expect(evaluateBackendGpuMatch([], 'linux-common_cpus-x64')).toEqual({
      kind: 'noGpu',
    })
    expect(evaluateBackendGpuMatch(undefined, 'linux-common_cpus-x64')).toEqual({
      kind: 'noGpu',
    })
  })

  it('reports gpuUnused when a GPU is present but a CPU build is installed', () => {
    expect(evaluateBackendGpuMatch([nvidia], 'linux-common_cpus-x64')).toEqual({
      kind: 'gpuUnused',
      gpus: [nvidia],
    })
  })

  it('reports a vendor mismatch for a cuda build on an AMD-only machine', () => {
    expect(
      evaluateBackendGpuMatch([amd], 'linux-cuda-12-common_cpus-x64')
    ).toEqual({ kind: 'vendorMismatch', family: 'cuda', gpus: [amd] })
  })

  it('reports a vendor mismatch for a hip build on an NVIDIA-only machine', () => {
    expect(
      evaluateBackendGpuMatch([nvidia], 'linux-hip-common_cpus-x64')
    ).toEqual({ kind: 'vendorMismatch', family: 'hip', gpus: [nvidia] })
  })

  it('accepts a cuda build on a hybrid machine where only one GPU is NVIDIA', () => {
    expect(
      evaluateBackendGpuMatch([intel, nvidia], 'linux-cuda-12-common_cpus-x64')
    ).toEqual({ kind: 'ok' })
  })

  it('reports unknown while no backend is selected yet', () => {
    expect(evaluateBackendGpuMatch([nvidia], '')).toEqual({ kind: 'unknown' })
    expect(evaluateBackendGpuMatch([nvidia], undefined)).toEqual({
      kind: 'unknown',
    })
    expect(evaluateBackendGpuMatch([nvidia], 'none')).toEqual({
      kind: 'unknown',
    })
  })

  it('never warns about a macOS build', () => {
    expect(evaluateBackendGpuMatch([], 'macos-arm64')).toEqual({ kind: 'ok' })
  })

  // A mismatch claim would tell the user to reinstall a backend that works.
  it('does not claim a mismatch when no vendor could be identified', () => {
    expect(
      evaluateBackendGpuMatch(
        [{ name: 'Display Adapter', vendor: 'Unknown (vendor_id: 5140)' }],
        'linux-cuda-12-common_cpus-x64'
      )
    ).toEqual({ kind: 'ok' })
  })

  it('does not claim a mismatch when no GPU was detected at all', () => {
    expect(
      evaluateBackendGpuMatch([], 'linux-cuda-12-common_cpus-x64')
    ).toEqual({ kind: 'ok' })
  })

  it('still reports a mismatch when one GPU is identified and none match', () => {
    expect(
      evaluateBackendGpuMatch(
        [{ vendor: 'Unknown (vendor_id: 5140)' }, amd],
        'linux-cuda-12-common_cpus-x64'
      )
    ).toMatchObject({ kind: 'vendorMismatch', family: 'cuda' })
  })
})

describe('describeGpus', () => {
  it('renders name and rounded VRAM', () => {
    expect(describeGpus([nvidia])).toBe('NVIDIA GeForce RTX 4090 (24 GB)')
  })

  it('joins multiple GPUs', () => {
    expect(describeGpus([intel, nvidia])).toBe(
      'Intel Iris Xe Graphics (2 GB), NVIDIA GeForce RTX 4090 (24 GB)'
    )
  })

  it('omits VRAM when unreported and falls back to the vendor', () => {
    expect(describeGpus([{ vendor: 'AMD' }])).toBe('AMD')
  })

  it('drops entries with nothing to say', () => {
    expect(describeGpus([{}, nvidia])).toBe('NVIDIA GeForce RTX 4090 (24 GB)')
  })
})
