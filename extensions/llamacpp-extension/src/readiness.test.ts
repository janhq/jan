import { describe, it, expect } from 'vitest'
import {
  backendFromDeviceIds,
  evaluateGpuOffload,
  evaluateEmbeddingVector,
} from './readiness'

describe('backendFromDeviceIds', () => {
  // The backend is read off the device the engine actually enumerated, which
  // is what makes it trustworthy: a configured name never proved the runtime
  // had loaded.
  it('strips the device index to name the backend', () => {
    expect(backendFromDeviceIds(['CUDA0'])).toBe('cuda')
    expect(backendFromDeviceIds(['Vulkan0'])).toBe('vulkan')
    expect(backendFromDeviceIds(['Metal0'])).toBe('metal')
    expect(backendFromDeviceIds(['ROCm1'])).toBe('rocm')
  })

  it('uses the first accelerator when several are present', () => {
    expect(backendFromDeviceIds(['CUDA0', 'CUDA1'])).toBe('cuda')
  })

  it('is empty when no device was enumerated', () => {
    expect(backendFromDeviceIds([])).toBe('')
    expect(backendFromDeviceIds(['', '  '])).toBe('')
  })

  // A multi-digit index must not eat part of the name.
  it('only strips trailing digits', () => {
    expect(backendFromDeviceIds(['Vulkan10'])).toBe('vulkan')
  })

  // On macOS the engine lists the Accelerate BLAS device before the Metal one
  // (`jan-llama-worker --list-devices` -> [BLAS, MTL0]). BLAS is a CPU math
  // library, not where the layers run, and Metal's id is `MTL`, not `Metal`;
  // naming the backend `blas` told Apple Silicon users they were on the CPU.
  it('names the GPU backend, not a CPU helper that is listed first', () => {
    expect(backendFromDeviceIds(['BLAS', 'MTL0'])).toBe('metal')
    expect(backendFromDeviceIds(['CPU', 'CUDA0'])).toBe('cuda')
    expect(backendFromDeviceIds(['BLAS', 'Vulkan0', 'Vulkan1'])).toBe('vulkan')
  })

  it('names Metal for its own device id', () => {
    expect(backendFromDeviceIds(['MTL0'])).toBe('metal')
  })

  // With no GPU device the CPU-side name is the honest answer, and it must
  // keep reading as a CPU backend.
  it('keeps a CPU-only device list as a CPU backend', () => {
    expect(backendFromDeviceIds(['BLAS'])).toBe('blas')
    expect(backendFromDeviceIds(['CPU'])).toBe('cpu')
  })
})

describe('evaluateGpuOffload', () => {
  it('passes a machine with no GPU without expecting offload', () => {
    const result = evaluateGpuOffload({
      engineDeviceCount: 0,
      hardwareGpuCount: 0,
    })
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('passes a GPU the engine can actually use', () => {
    const result = evaluateGpuOffload({
      engineDeviceCount: 1,
      hardwareGpuCount: 1,
    })
    expect(result.status).toBe('ok')
    expect(result.gpuExpected).toBe(true)
  })

  // The one failure worth reporting now that the engine ships with the app: a
  // GPU is present but the engine cannot reach it, which is a driver or runtime
  // problem. There is no longer a "wrong variant installed" case.
  it('warns when a present GPU is invisible to the engine', () => {
    const result = evaluateGpuOffload({
      engineDeviceCount: 0,
      hardwareGpuCount: 1,
    })
    expect(result.status).toBe('warning')
    expect(result.reason).toBe('runtimeUnreachable')
  })

  it('reports the engine device count it based the verdict on', () => {
    expect(
      evaluateGpuOffload({ engineDeviceCount: 2, hardwareGpuCount: 2 })
        .engineDeviceCount
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
