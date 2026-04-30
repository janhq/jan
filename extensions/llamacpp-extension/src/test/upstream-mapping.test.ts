import { describe, it, expect, vi } from 'vitest'

// mapUpstreamAssetToInternal is the helper that translates upstream
// ggml-org/llama.cpp asset stems (e.g. "ubuntu-vulkan-x64") to Jan's internal
// backend identifiers (e.g. "linux-vulkan-common_cpus-x64") for the
// install-from-file flow. Without this mapping, a user who downloads a vanilla
// upstream archive and installs it lands in a directory whose name doesn't
// match what determineSupportedBackends returns — so the backend installs on
// disk but never appears in the UI dropdown (issue #7973).

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
vi.mock('../util', () => ({
  getProxyConfig: vi.fn(),
  basenameNoExt: vi.fn(),
}))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  mapOldBackendToNew: vi.fn(),
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

describe('mapUpstreamAssetToInternal (install-from-file)', () => {
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
    // When installBackend sees null it falls back to the original stem — so
    // these names do reach disk, they just won't be auto-mapped to a Jan
    // backend identifier. Keeping the list explicit so we notice if upstream
    // ever renames a stem we *do* support.
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
