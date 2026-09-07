import { describe, expect, it } from 'vitest'
import {
  getBackendDisplayName,
  getInstallRecommendations,
} from '../backendDependencies'

const CUDA12 = 'linux-cuda-12-common_cpus-x64'

describe('getBackendDisplayName', () => {
  it('names each CUDA major version', () => {
    expect(getBackendDisplayName('linux-cuda-11-common_cpus-x64')).toBe(
      'NVIDIA CUDA 11 Backend'
    )
    expect(getBackendDisplayName(CUDA12)).toBe('NVIDIA CUDA 12 Backend')
    expect(getBackendDisplayName('win-cuda-13-common_cpus-x64')).toBe(
      'NVIDIA CUDA 13 Backend'
    )
  })

  it('names the non-CUDA backends', () => {
    expect(getBackendDisplayName('linux-vulkan-common_cpus-x64')).toBe(
      'Vulkan Backend'
    )
    expect(getBackendDisplayName('linux-common_cpus-x64')).toBe('CPU Backend')
  })

  it('passes an unrecognised backend through unchanged', () => {
    expect(getBackendDisplayName('something-new')).toBe('something-new')
  })
})

describe('getInstallRecommendations', () => {
  // A missing bundled lib means a corrupted download, not a missing toolkit, so
  // it must be claimed before the CUDA filter can absorb the name.
  it('attributes a missing bundled lib to the download, not to CUDA', () => {
    const { recommendations, uncovered } = getInstallRecommendations(
      ['libggml-cuda.so'],
      CUDA12
    )
    expect(recommendations).toHaveLength(1)
    expect(recommendations[0].label).toBe('Re-download the backend')
    expect(uncovered).toEqual([])
  })

  it('recommends the matching CUDA toolkit version', () => {
    const { recommendations } = getInstallRecommendations(
      ['libcublas.so.12'],
      CUDA12
    )
    expect(recommendations[0].label).toBe('NVIDIA CUDA Toolkit 12')
    expect(recommendations[0].url).toContain('nvidia.com')
  })

  // NCCL names appear on non-CUDA builds too; recommending it there would be
  // advice for a dependency that build never needed.
  it('only recommends NCCL on a CUDA build', () => {
    expect(
      getInstallRecommendations(['libnccl.so.2'], CUDA12).recommendations.map(
        (r) => r.label
      )
    ).toContain('NVIDIA NCCL')

    const vulkan = getInstallRecommendations(
      ['libnccl.so.2'],
      'linux-vulkan-common_cpus-x64'
    )
    expect(vulkan.recommendations.map((r) => r.label)).not.toContain(
      'NVIDIA NCCL'
    )
    expect(vulkan.uncovered).toEqual(['libnccl.so.2'])
  })

  it('recommends the Vulkan loader for a missing vulkan lib', () => {
    const { recommendations } = getInstallRecommendations(
      ['libvulkan.so.1'],
      'linux-vulkan-common_cpus-x64'
    )
    expect(recommendations[0].label).toBe('Vulkan Runtime')
  })

  it('never counts one library under two recommendations', () => {
    const { recommendations, uncovered } = getInstallRecommendations(
      ['libggml-cuda.so', 'libcudart.so.12', 'libnccl.so.2'],
      CUDA12
    )
    const claimed = recommendations.flatMap((r) => r.libs)
    expect(new Set(claimed).size).toBe(claimed.length)
    expect([...claimed, ...uncovered].sort()).toEqual([
      'libcudart.so.12',
      'libggml-cuda.so',
      'libnccl.so.2',
    ])
  })

  it('reports an unrecognised library as uncovered', () => {
    const { recommendations, uncovered } = getInstallRecommendations(
      ['libmystery.so.1'],
      CUDA12
    )
    expect(recommendations).toEqual([])
    expect(uncovered).toEqual(['libmystery.so.1'])
  })

  it('returns nothing for an empty list', () => {
    expect(getInstallRecommendations([], CUDA12)).toEqual({
      recommendations: [],
      uncovered: [],
    })
  })
})
