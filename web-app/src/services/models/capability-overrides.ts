/**
 * Capability Override Service
 * Allows manual configuration of model capabilities (tool calling, vision, etc.)
 */

interface CapabilityOverride {
  modelId: string
  capabilities: string[]
  updatedAt: number
}

const STORAGE_KEY = 'model_capability_overrides'

export class CapabilityOverrideService {
  private loadOverrides(): Map<string, CapabilityOverride> {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (!data) return new Map()

      const parsed = JSON.parse(data) as CapabilityOverride[]
      return new Map(parsed.map((override) => [override.modelId, override]))
    } catch (error) {
      console.error('Failed to load capability overrides:', error)
      return new Map()
    }
  }

  private saveOverrides(overrides: Map<string, CapabilityOverride>): void {
    try {
      const data = Array.from(overrides.values())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('Failed to save capability overrides:', error)
    }
  }

  getOverride(modelId: string): CapabilityOverride | undefined {
    const overrides = this.loadOverrides()
    return overrides.get(modelId)
  }

  setOverride(modelId: string, capabilities: string[]): void {
    const overrides = this.loadOverrides()

    overrides.set(modelId, {
      modelId,
      capabilities,
      updatedAt: Date.now(),
    })

    this.saveOverrides(overrides)
  }

  removeOverride(modelId: string): void {
    const overrides = this.loadOverrides()
    overrides.delete(modelId)
    this.saveOverrides(overrides)
  }

  hasOverride(modelId: string): boolean {
    const overrides = this.loadOverrides()
    return overrides.has(modelId)
  }

  toggleCapability(
    modelId: string,
    capability: string,
    currentCapabilities: string[]
  ): string[] {
    const override = this.getOverride(modelId)
    const existingCapabilities = override?.capabilities || currentCapabilities

    const newCapabilities = existingCapabilities.includes(capability)
      ? existingCapabilities.filter((c) => c !== capability)
      : [...existingCapabilities, capability]

    this.setOverride(modelId, newCapabilities)
    return newCapabilities
  }

  getAllOverrides(): CapabilityOverride[] {
    const overrides = this.loadOverrides()
    return Array.from(overrides.values())
  }

  clearAllOverrides(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear capability overrides:', error)
    }
  }
}

export const capabilityOverrideService = new CapabilityOverrideService()
