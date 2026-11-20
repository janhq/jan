import type { GPU } from '@/hooks/useHardware'

/** Split a llama.cpp device id such as `Vulkan1` into backend and index. */
export function parseDeviceId(id: string): { backend: string; index: number } {
  const match = /^([A-Za-z]+?)(\d+)$/.exec(id ?? '')
  if (!match) return { backend: id ?? '', index: 0 }
  return { backend: match[1], index: Number(match[2]) }
}

const isVulkan = (id: string) =>
  parseDeviceId(id).backend.toLowerCase() === 'vulkan'

/**
 * Find the hardware-plugin GPU behind a llama.cpp device.
 *
 * llama.cpp's `Vulkan<N>` is a position among the devices it kept (filtered and
 * reordered by `GGML_VK_VISIBLE_DEVICES`, hybrid-graphics setups), while the
 * plugin's `vulkan_info.index` is the raw enumeration index. Joining on the
 * number attaches one GPU's driver and compute capability to another's card, so
 * Vulkan devices are joined by name instead. Names are not always equal: the
 * plugin keeps the NVML name for NVIDIA cards and Vulkan's `deviceName` for the
 * rest. So when exactly one Vulkan device and one GPU are left unmatched by
 * name, they are paired. Identical twin cards, which a name cannot tell apart,
 * are paired by rank among same-named devices. Two or more differently named
 * mismatches are left blank rather than guessed. CUDA numbering is the
 * plugin's own, so it stays index-based.
 */
export function findGpuForDevice(
  device: { id: string; name: string },
  gpus: GPU[],
  allDevices: { id: string; name: string }[] = [device]
): GPU | undefined {
  const { backend, index } = parseDeviceId(device.id)
  if (backend.toLowerCase() === 'cuda') {
    return gpus.find((gpu) => gpu.nvidia_info?.index === index)
  }
  if (backend.toLowerCase() !== 'vulkan') return undefined

  const vulkanGpus = gpus.filter((gpu) => gpu.vulkan_info)
  const named = vulkanGpus.filter((gpu) => gpu.name === device.name)
  if (named.length === 1) return named[0]
  if (named.length > 1) {
    // The plugin numbers every physical device, llama.cpp only the ones it
    // kept, so the raw numbers disagree. Pair twins by rank instead.
    const rank = allDevices
      .filter((d) => isVulkan(d.id) && d.name === device.name)
      .map((d) => parseDeviceId(d.id).index)
      .sort((a, b) => a - b)
      .indexOf(index)
    return [...named].sort(
      (a, b) => (a.vulkan_info?.index ?? 0) - (b.vulkan_info?.index ?? 0)
    )[rank]
  }

  const vulkanDevices = allDevices.filter((d) => isVulkan(d.id))
  const unmatchedDevices = vulkanDevices.filter(
    (d) => !vulkanGpus.some((gpu) => gpu.name === d.name)
  )
  const unmatchedGpus = vulkanGpus.filter(
    (gpu) => !vulkanDevices.some((d) => d.name === gpu.name)
  )
  return unmatchedDevices.length === 1 && unmatchedGpus.length === 1
    ? unmatchedGpus[0]
    : undefined
}
