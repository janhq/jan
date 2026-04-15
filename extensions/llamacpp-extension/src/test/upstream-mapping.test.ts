import { describe, it, expect, vi } from 'vitest'

// The module under test pulls in @janhq/core etc. at import time, so stub the
// bits it touches before importing.
vi.mock('@janhq/core', () => ({
  getJanDataFolderPath: vi.fn().mockResolvedValue('/path/to/jan'),
  fs: { existsSync: vi.fn(), readdirSync: vi.fn(), rm: vi.fn() },
  joinPath: vi.fn(async (paths: string[]) => paths.join('/')),
  events: { emit: vi.fn() },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(),
  basename: vi.fn(),
}))
vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  getSystemInfo: vi.fn(),
}))
vi.mock('../util', () => ({ getProxyConfig: vi.fn() }))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  getLocalInstalledBackendsInternal: vi.fn(),
  normalizeFeatures: vi.fn(),
  determineSupportedBackends: vi.fn(),
  listSupportedBackendsFromRust: vi.fn(),
  getSupportedFeaturesFromRust: vi.fn(),
  isCudaInstalledFromRust: vi.fn(),
}))

vi.stubGlobal('IS_WINDOWS', false)
vi.stubGlobal('window', {
  core: { extensionManager: { getByName: vi.fn() } },
})

import { mapUpstreamAssetToInternal } from '../backend'

describe('mapUpstreamAssetToInternal', () => {
  it('maps macOS asset stems 1:1', () => {
    expect(mapUpstreamAssetToInternal('macos-arm64')).toBe('macos-arm64')
    expect(mapUpstreamAssetToInternal('macos-x64')).toBe('macos-x64')
  })

  it('maps upstream ubuntu-* stems to linux-* internal names', () => {
    expect(mapUpstreamAssetToInternal('ubuntu-x64')).toBe(
      'linux-common_cpus-x64'
    )
    expect(mapUpstreamAssetToInternal('ubuntu-arm64')).toBe('linux-arm64')
    expect(mapUpstreamAssetToInternal('ubuntu-vulkan-x64')).toBe(
      'linux-vulkan-common_cpus-x64'
    )
  })

  it('maps Windows CPU and Vulkan stems to common_cpus naming', () => {
    expect(mapUpstreamAssetToInternal('win-cpu-x64')).toBe(
      'win-common_cpus-x64'
    )
    expect(mapUpstreamAssetToInternal('win-cpu-arm64')).toBe('win-arm64')
    expect(mapUpstreamAssetToInternal('win-vulkan-x64')).toBe(
      'win-vulkan-common_cpus-x64'
    )
  })

  it('collapses Windows CUDA minor versions to major-only buckets', () => {
    expect(mapUpstreamAssetToInternal('win-cuda-12.4-x64')).toBe(
      'win-cuda-12-common_cpus-x64'
    )
    expect(mapUpstreamAssetToInternal('win-cuda-13.1-x64')).toBe(
      'win-cuda-13-common_cpus-x64'
    )
    // Double-digit major versions should still parse correctly.
    expect(mapUpstreamAssetToInternal('win-cuda-20.0-x64')).toBe(
      'win-cuda-20-common_cpus-x64'
    )
  })

  it('returns null for assets Jan does not currently ship backends for', () => {
    expect(mapUpstreamAssetToInternal('ubuntu-rocm-7.2-x64')).toBeNull()
    expect(mapUpstreamAssetToInternal('ubuntu-openvino-2026.0-x64')).toBeNull()
    expect(mapUpstreamAssetToInternal('ubuntu-s390x')).toBeNull()
    expect(mapUpstreamAssetToInternal('ubuntu-vulkan-arm64')).toBeNull()
    expect(mapUpstreamAssetToInternal('win-sycl-x64')).toBeNull()
    expect(mapUpstreamAssetToInternal('win-hip-radeon-x64')).toBeNull()
    expect(mapUpstreamAssetToInternal('win-opencl-adreno-arm64')).toBeNull()
    expect(mapUpstreamAssetToInternal('310p-openEuler-aarch64')).toBeNull()
    expect(mapUpstreamAssetToInternal('macos-arm64-kleidiai')).toBeNull()
  })

  it('returns null for malformed CUDA stems', () => {
    // Missing minor version — upstream always ships "<major>.<minor>".
    expect(mapUpstreamAssetToInternal('win-cuda-12-x64')).toBeNull()
    // Wrong arch suffix.
    expect(mapUpstreamAssetToInternal('win-cuda-12.4-arm64')).toBeNull()
  })
})
