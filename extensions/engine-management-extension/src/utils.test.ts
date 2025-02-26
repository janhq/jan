import { describe, it, expect, vi } from 'vitest'
import { engineVariant } from './utils'

vi.mock('@janhq/core', () => {
  return {
    log: () => {},
  }
})

describe('engineVariant', () => {
  it('should return mac-arm64 when platform is darwin and arch is arm64', async () => {
    vi.stubGlobal('PLATFORM', 'darwin')
    const result = await engineVariant({
      cpu: { arch: 'arm64', instructions: '' },
      gpus: [],
      vulkan: false,
    })
    expect(result).toBe('mac-arm64')
  })

  it('should return mac-amd64 when platform is darwin and arch is not arm64', async () => {
    vi.stubGlobal('PLATFORM', 'darwin')
    const result = await engineVariant({
      cpu: { arch: 'x64', instructions: [] },
      gpus: [],
      vulkan: false,
    })
    expect(result).toBe('mac-amd64')
  })

  it('should return windows-amd64-noavx-cuda-12-0 when platform is win32, cuda is enabled, and cuda version is 12', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    const result = await engineVariant({
      cpu: { arch: 'x64', instructions: ['avx2'] },
      gpus: [
        {
          activated: true,
          version: '12',
          additional_information: { driver_version: '1.0' },
        },
      ],
      vulkan: false,
    })
    expect(result).toBe('windows-amd64-avx2-cuda-12-0')
  })

  it('should return linux-amd64-noavx-cuda-11-7 when platform is linux, cuda is enabled, and cuda version is 11', async () => {
    vi.stubGlobal('PLATFORM', 'linux')
    const result = await engineVariant({
      cpu: { arch: 'x64', instructions: [] },
      gpus: [
        {
          activated: true,
          version: '11',
          additional_information: { driver_version: '1.0' },
        },
      ],
      vulkan: false,
    })
    expect(result).toBe('linux-amd64-noavx-cuda-11-7')
  })

  it('should return windows-amd64-vulkan when platform is win32 and vulkan is enabled', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    const result = await engineVariant({
      cpu: { arch: 'x64', instructions: [] },
      gpus: [{ activated: true, version: '12' }],
      vulkan: true,
    })
    expect(result).toBe('windows-amd64-vulkan')
  })

  it('should return windows-amd64-avx512 when platform is win32, no gpu detected and avx512 cpu instruction is supported', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    const result = await engineVariant({
      cpu: { arch: 'x64', instructions: ['avx512'] },
      gpus: [{ activated: true, version: '12' }],
    })
    expect(result).toBe('windows-amd64-avx512')
  })

  it('should return windows-amd64-avx512 when platform is win32, no gpu detected and no accelerated cpu instructions are supported', async () => {
    vi.stubGlobal('PLATFORM', 'win32')
    const result = await engineVariant({
      cpu: { arch: 'x64', instructions: [''] },
      gpus: [{ activated: true, version: '12' }],
    })
    expect(result).toBe('windows-amd64-noavx')
  })
})
