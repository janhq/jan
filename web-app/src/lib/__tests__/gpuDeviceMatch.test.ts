import { describe, it, expect } from 'vitest'
import { findGpuForDevice } from '../gpuDeviceMatch'
import type { GPU } from '@/hooks/useHardware'

const gpu = (name: string, vulkanIndex: number | null, cudaIndex?: number) =>
  ({
    name,
    uuid: name,
    driver_version: name,
    nvidia_info:
      cudaIndex === undefined
        ? null
        : { index: cudaIndex, compute_capability: '8.9' },
    vulkan_info:
      vulkanIndex === null
        ? null
        : {
            index: vulkanIndex,
            device_id: 0,
            device_type: '',
            api_version: '1',
          },
  }) as unknown as GPU

const nvidia = gpu('RTX 4060 Ti', 0, 0)
const intel = gpu('Intel UHD 770', 1)

describe('findGpuForDevice', () => {
  it('joins a Vulkan device by name when llama.cpp reorders devices', () => {
    // GGML_VK_VISIBLE_DEVICES=1,0 makes Intel Vulkan0.
    const found = findGpuForDevice(
      { id: 'Vulkan0', name: 'Intel UHD 770' },
      [nvidia, intel]
    )
    expect(found).toBe(intel)
  })

  it('falls back to the index for identical twin cards', () => {
    const a = gpu('Twin', 0)
    const b = gpu('Twin', 1)
    expect(findGpuForDevice({ id: 'Vulkan1', name: 'Twin' }, [a, b])).toBe(b)
  })

  it('pairs the one leftover device and GPU when an NVML name differs', () => {
    const devices = [
      { id: 'Vulkan0', name: 'NVIDIA GeForce RTX 4060 Ti' },
      { id: 'Vulkan1', name: 'Intel UHD 770' },
    ]
    expect(findGpuForDevice(devices[0], [intel, nvidia], devices)).toBe(nvidia)
    expect(findGpuForDevice(devices[1], [intel, nvidia], devices)).toBe(intel)
  })

  it('does not guess when several devices are unmatched', () => {
    const devices = [
      { id: 'Vulkan0', name: 'A' },
      { id: 'Vulkan1', name: 'B' },
    ]
    expect(
      findGpuForDevice(devices[0], [nvidia, gpu('Other', 1)], devices)
    ).toBeUndefined()
  })

  it('returns nothing when the name matches no GPU', () => {
    expect(
      findGpuForDevice({ id: 'Vulkan0', name: 'Mystery' }, [nvidia, intel])
    ).toBeUndefined()
  })

  it('keeps CUDA joined by index', () => {
    expect(
      findGpuForDevice({ id: 'CUDA0', name: 'RTX 4060 Ti' }, [intel, nvidia])
    ).toBe(nvidia)
  })

  it('returns nothing for other backends', () => {
    expect(
      findGpuForDevice({ id: 'Metal0', name: 'x' }, [nvidia])
    ).toBeUndefined()
  })
})
