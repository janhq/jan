import { describe, it, expect } from 'vitest'
import {
  backendImpliesGpu,
  isBackendConfigured,
  evaluateGpuOffload,
  evaluateEmbeddingVector,
} from './readiness'

describe('backendImpliesGpu', () => {
  it('recognizes every GPU variant Jan ships', () => {
    for (const backend of [
      'linux-cuda-12-common_cpus-x64',
      'linux-cuda-11-common_cpus-x64',
      'win-cuda-13-common_cpus-x64',
      'linux-vulkan-common_cpus-x64',
      'linux-hip-common_cpus-x64',
    ]) {
      expect(backendImpliesGpu(backend), backend).toBe(true)
    }
  })

  it('does not flag CPU variants', () => {
    for (const backend of [
      'linux-common_cpus-x64',
      'win-common_cpus-x64',
      'win-arm64',
      'linux-noavx-x64',
      'linux-avx2-x64',
    ]) {
      expect(backendImpliesGpu(backend), backend).toBe(false)
    }
  })

  // Metal is implicit on Apple Silicon and always available, so a macOS build
  // must not be reported as a GPU variant that failed to find a device.
  it('does not flag macOS builds', () => {
    expect(backendImpliesGpu('macos-arm64')).toBe(false)
    expect(backendImpliesGpu('macos-x64')).toBe(false)
  })

  it('tolerates an empty or missing backend id', () => {
    expect(backendImpliesGpu('')).toBe(false)
    expect(backendImpliesGpu(undefined as unknown as string)).toBe(false)
  })
})

describe('evaluateGpuOffload', () => {
  it('passes a CPU backend without looking at devices', () => {
    const result = evaluateGpuOffload({
      backend: 'linux-common_cpus-x64',
      engineDeviceCount: 0,
      hardwareGpuCount: 0,
    })
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('passes a GPU backend that the engine can actually use', () => {
    const result = evaluateGpuOffload({
      backend: 'linux-cuda-12-common_cpus-x64',
      engineDeviceCount: 1,
      hardwareGpuCount: 1,
    })
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(true)
  })

  // The machine has no GPU at all: the wrong variant was installed.
  it('warns when a GPU backend finds no devices and no GPU hardware exists', () => {
    const result = evaluateGpuOffload({
      backend: 'linux-cuda-12-common_cpus-x64',
      engineDeviceCount: 0,
      hardwareGpuCount: 0,
    })
    expect(result.status).toBe('warning')
    expect(result.reason).toBe('noGpuHardware')
  })

  // A GPU exists but the engine cannot reach it, which is a driver/runtime
  // problem and needs different advice than "you have no GPU".
  it('distinguishes a present GPU the engine cannot reach', () => {
    const result = evaluateGpuOffload({
      backend: 'linux-cuda-12-common_cpus-x64',
      engineDeviceCount: 0,
      hardwareGpuCount: 1,
    })
    expect(result.status).toBe('warning')
    expect(result.reason).toBe('runtimeUnreachable')
  })

  it('reports the engine device count it based the verdict on', () => {
    expect(
      evaluateGpuOffload({
        backend: 'linux-cuda-12-common_cpus-x64',
        engineDeviceCount: 2,
        hardwareGpuCount: 2,
      }).engineDeviceCount
    ).toBe(2)
  })
})

describe('evaluateEmbeddingVector', () => {
  it('accepts a healthy vector and reports its dimension', () => {
    const result = evaluateEmbeddingVector([0.1, -0.2, 0.3])
    expect(result.ok).toBe(true)
    expect(result.dimension).toBe(3)
    expect(result.problem).toBeUndefined()
  })

  it('rejects a missing vector', () => {
    expect(evaluateEmbeddingVector(undefined).problem).toBe('missing')
    expect(evaluateEmbeddingVector(null).problem).toBe('missing')
    expect(evaluateEmbeddingVector('nope').problem).toBe('missing')
  })

  // vector-db rejects this later with "embedding is empty"; catching it during
  // setup turns a first-attachment failure into an onboarding warning.
  it('rejects an empty vector', () => {
    const result = evaluateEmbeddingVector([])
    expect(result.ok).toBe(false)
    expect(result.problem).toBe('empty')
    expect(result.dimension).toBe(0)
  })

  it('rejects non-finite values that sqlite-vec would refuse', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const result = evaluateEmbeddingVector([0.1, bad, 0.3])
      expect(result.ok, String(bad)).toBe(false)
      expect(result.problem).toBe('nonFinite')
    }
  })

  it('rejects non-numeric entries', () => {
    expect(evaluateEmbeddingVector([0.1, '0.2', 0.3]).problem).toBe('nonFinite')
  })

  // An all-zero vector makes cosine similarity divide by zero, so retrieval
  // silently returns nothing useful. It signals a misconfigured pooling type.
  it('rejects a degenerate all-zero vector', () => {
    const result = evaluateEmbeddingVector([0, 0, 0])
    expect(result.ok).toBe(false)
    expect(result.problem).toBe('degenerate')
    expect(result.dimension).toBe(3)
  })
})

describe('isBackendConfigured', () => {
  it('accepts a well-formed version/backend pair', () => {
    expect(isBackendConfigured('b6099/linux-cuda-12-common_cpus-x64')).toBe(true)
  })

  // A fresh install sits in these states through a catalog fetch and a backend
  // download; treating them as "configured" is what made a probe report a
  // defect instead of an absence.
  it('rejects the fresh-install placeholders', () => {
    for (const value of ['', '   ', 'none', undefined, null]) {
      expect(isBackendConfigured(value), String(value)).toBe(false)
    }
  })

  it('rejects a malformed pair', () => {
    for (const value of ['b6099', 'b6099/', '/linux-cuda', '/']) {
      expect(isBackendConfigured(value), value).toBe(false)
    }
  })
})
