import type { GPU } from '@/hooks/useHardware'

/** Split a llama.cpp device id such as `Vulkan1` into backend and index. */
export function parseDeviceId(id: string): { backend: string; index: number } {
  const match = /^([A-Za-z]+?)(\d+)$/.exec(id ?? '')
  if (!match) return { backend: id ?? '', index: 0 }
  return { backend: match[1], index: Number(match[2]) }
}

/**
 * Find the hardware-plugin GPU behind a llama.cpp device.
 *
 * llama.cpp's `Vulkan<N>` is a position among the devices it kept (filtered and
 * reordered by `GGML_VK_VISIBLE_DEVICES`, hybrid-graphics setups), while the
 * plugin's `vulkan_info.index` is the raw enumeration index. Joining on the
 * number attaches one GPU's driver and compute capability to another's card, so
 * Vulkan devices are joined by name, which both sides read from Vulkan. Only
 * identical twin cards, which a name cannot tell apart, fall back to the index.
 * CUDA numbering is the plugin's own, so it stays index-based.
 */
export function findGpuForDevice(
  device: { id: string; name: string },
  gpus: GPU[]
): GPU | undefined {
  const { backend, index } = parseDeviceId(device.id)
  const key = backend.toLowerCase()
  if (key === 'cuda') {
    return gpus.find((gpu) => gpu.nvidia_info?.index === index)
  }
  if (key !== 'vulkan') return undefined

  const named = gpus.filter(
    (gpu) => gpu.vulkan_info && gpu.name === device.name
  )
  if (named.length <= 1) return named[0]
  return named.find((gpu) => gpu.vulkan_info?.index === index)
}
