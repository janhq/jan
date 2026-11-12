import type { DeviceList } from '@janhq/tauri-plugin-llamacpp-api'

/** The subset of the hardware plugin's `GpuInfo` this module reads. */
export interface HardwareGpu {
  name?: string
  vendor?: unknown
  uuid?: string
  vulkan_info?: { index?: number } | null
}

/** The subset of the hardware plugin's `GpuUsage` this module reads. */
export interface HardwareGpuUsage {
  uuid?: string
  total_memory?: number
  used_memory?: number
}

/**
 * Replace the memory ggml-vulkan reports for AMD devices with the dedicated
 * VRAM the hardware plugin reads from sysfs.
 *
 * ggml-vulkan reports an integrated GPU's shared (UMA) memory as device-local,
 * so an APU shows far more memory than its carve-out.
 *
 * The two lists number devices independently. ggml's `Vulkan<N>` is a position
 * among the devices it kept (software devices skipped, duplicate drivers
 * merged, `GGML_VK_VISIBLE_DEVICES` applied), while the plugin's
 * `vulkan_info.index` is the raw enumeration index. Joining on the number gives
 * a device another GPU's VRAM, so devices are joined by name instead: both
 * sides read Vulkan's `deviceName`. A device whose name matches nothing, or
 * matches more than one GPU (identical cards, which cannot be told apart),
 * keeps ggml's own figures.
 */
export function overrideAmdVulkanMemory(
  devices: DeviceList[],
  gpus: HardwareGpu[],
  usage: HardwareGpuUsage[]
): DeviceList[] {
  const uuidToUsage = new Map<string, HardwareGpuUsage>()
  for (const u of usage) {
    if (u && typeof u.uuid === 'string') uuidToUsage.set(u.uuid, u)
  }

  // A name identifies a GPU only when exactly one hardware GPU and one ggml
  // device carry it. Identical cards share total VRAM but not free memory, and
  // nothing here says which twin is which, so they keep ggml's figures.
  const gpuByName = new Map<string, string | null>()
  for (const gpu of gpus) {
    if (
      typeof gpu?.vendor !== 'string' ||
      !gpu.vendor.toUpperCase().includes('AMD') ||
      typeof gpu.vulkan_info?.index !== 'number' ||
      typeof gpu.uuid !== 'string' ||
      typeof gpu.name !== 'string'
    ) {
      continue
    }
    gpuByName.set(gpu.name, gpuByName.has(gpu.name) ? null : gpu.uuid)
  }
  if (gpuByName.size === 0) return devices

  const deviceCountByName = new Map<string, number>()
  for (const dev of devices) {
    if (/^Vulkan\d+/.test(dev.id ?? '')) {
      deviceCountByName.set(
        dev.name,
        (deviceCountByName.get(dev.name) ?? 0) + 1
      )
    }
  }
  const uuidFor = (dev: DeviceList) =>
    /^Vulkan\d+/.test(dev.id ?? '') && deviceCountByName.get(dev.name) === 1
      ? gpuByName.get(dev.name)
      : undefined

  return devices.map((dev) => {
    const uuid = uuidFor(dev)
    const u = uuid ? uuidToUsage.get(uuid) : undefined
    if (
      !u ||
      typeof u.total_memory !== 'number' ||
      typeof u.used_memory !== 'number'
    ) {
      return dev
    }
    const total = Math.max(0, Math.floor(u.total_memory))
    const free = Math.max(0, Math.floor(u.total_memory - u.used_memory))
    return { ...dev, mem: total, free }
  })
}
