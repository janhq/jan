import { describe, expect, it } from 'vitest'
import type { DeviceList } from '@janhq/tauri-plugin-llamacpp-api'
import {
  overrideAmdVulkanMemory,
  type HardwareGpu,
  type HardwareGpuUsage,
} from './deviceMemory'

const WX = 'AMD Radeon Pro WX 5100 (RADV POLARIS10)'
const APU = 'AMD Radeon Graphics (RADV RENOIR)'

// What ggml-vulkan reports before the override: the APU's shared memory is
// counted as device-local, so it is larger than its carve-out.
const ggml = (id: string, name: string, mem: number): DeviceList => ({
  id,
  name,
  mem,
  free: mem,
})

const amd = (name: string, uuid: string, index: number): HardwareGpu => ({
  name,
  vendor: 'AMD',
  uuid,
  vulkan_info: { index },
})

const used = (
  uuid: string,
  total_memory: number,
  used_memory = 0
): HardwareGpuUsage => ({ uuid, total_memory, used_memory })

const WX_USAGE = used('uuid-wx', 8192, 1000)
const APU_USAGE = used('uuid-apu', 16384, 2000)

const memOf = (list: DeviceList[], id: string) => {
  const d = list.find((x) => x.id === id)
  return d && { mem: d.mem, free: d.free }
}

describe('overrideAmdVulkanMemory', () => {
  it('gives each device its own VRAM when both lists agree on order', () => {
    const out = overrideAmdVulkanMemory(
      [ggml('Vulkan0', APU, 24000), ggml('Vulkan1', WX, 8192)],
      [amd(APU, 'uuid-apu', 0), amd(WX, 'uuid-wx', 1)],
      [WX_USAGE, APU_USAGE]
    )
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 16384, free: 14384 })
    expect(memOf(out, 'Vulkan1')).toEqual({ mem: 8192, free: 7192 })
  })

  it('keeps the right VRAM when GGML_VK_VISIBLE_DEVICES hides the APU', () => {
    // ggml numbers only the devices it kept, so the dGPU becomes Vulkan0 while
    // the hardware plugin still lists it second.
    const out = overrideAmdVulkanMemory(
      [ggml('Vulkan0', WX, 8192)],
      [amd(APU, 'uuid-apu', 0), amd(WX, 'uuid-wx', 1)],
      [WX_USAGE, APU_USAGE]
    )
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 8192, free: 7192 })
  })

  it('keeps the right VRAM when a software device shifts raw indices', () => {
    // llvmpipe is enumerated first. ggml skips it; the hardware plugin counts
    // it in `index` but does not list it.
    const out = overrideAmdVulkanMemory(
      [ggml('Vulkan0', WX, 8192), ggml('Vulkan1', APU, 24000)],
      [amd(WX, 'uuid-wx', 1), amd(APU, 'uuid-apu', 2)],
      [WX_USAGE, APU_USAGE]
    )
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 8192, free: 7192 })
    expect(memOf(out, 'Vulkan1')).toEqual({ mem: 16384, free: 14384 })
  })

  it('keeps the right VRAM when ggml orders devices differently', () => {
    // ggml's driver de-duplication can move a device to the end of its list.
    const out = overrideAmdVulkanMemory(
      [ggml('Vulkan0', WX, 8192), ggml('Vulkan1', APU, 24000)],
      [amd(APU, 'uuid-apu', 0), amd(WX, 'uuid-wx', 1)],
      [WX_USAGE, APU_USAGE]
    )
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 8192, free: 7192 })
    expect(memOf(out, 'Vulkan1')).toEqual({ mem: 16384, free: 14384 })
  })

  it('leaves identical GPUs alone: their free memory cannot be told apart', () => {
    const twins = [amd(WX, 'uuid-a', 0), amd(WX, 'uuid-b', 1)]
    const twinUsage = [used('uuid-a', 8192, 100), used('uuid-b', 8192, 4000)]

    const both = overrideAmdVulkanMemory(
      [ggml('Vulkan0', WX, 8192), ggml('Vulkan1', WX, 8192)],
      twins,
      twinUsage
    )
    expect(memOf(both, 'Vulkan0')).toEqual({ mem: 8192, free: 8192 })
    expect(memOf(both, 'Vulkan1')).toEqual({ mem: 8192, free: 8192 })

    // One twin hidden by GGML_VK_VISIBLE_DEVICES: still no way to say which.
    const one = overrideAmdVulkanMemory(
      [ggml('Vulkan0', WX, 8192)],
      twins,
      twinUsage
    )
    expect(memOf(one, 'Vulkan0')).toEqual({ mem: 8192, free: 8192 })
  })

  it('leaves a device alone when no hardware GPU has its name', () => {
    // Never fall back to the index: a wrong size is worse than ggml's own.
    const out = overrideAmdVulkanMemory(
      [ggml('Vulkan0', 'Some Other GPU', 4096)],
      [amd(APU, 'uuid-apu', 0)],
      [APU_USAGE]
    )
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 4096, free: 4096 })
  })

  it('leaves non-Vulkan and non-AMD devices alone', () => {
    const nvidia: HardwareGpu = {
      name: 'NVIDIA GeForce RTX 4060',
      vendor: 'NVIDIA',
      uuid: 'uuid-nv',
      vulkan_info: { index: 0 },
    }
    const out = overrideAmdVulkanMemory(
      [
        ggml('CUDA0', 'NVIDIA GeForce RTX 4060', 8000),
        ggml('Vulkan0', 'NVIDIA GeForce RTX 4060', 8000),
        ggml('Vulkan1', WX, 8192),
      ],
      [nvidia, amd(WX, 'uuid-wx', 1)],
      [used('uuid-nv', 1, 0), WX_USAGE]
    )
    expect(memOf(out, 'CUDA0')).toEqual({ mem: 8000, free: 8000 })
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 8000, free: 8000 })
    expect(memOf(out, 'Vulkan1')).toEqual({ mem: 8192, free: 7192 })
  })

  it('leaves a device alone when the plugin has no usage for its GPU', () => {
    const out = overrideAmdVulkanMemory(
      [ggml('Vulkan0', WX, 8192)],
      [amd(WX, 'uuid-wx', 0)],
      []
    )
    expect(memOf(out, 'Vulkan0')).toEqual({ mem: 8192, free: 8192 })
  })
})
