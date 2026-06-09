export const MANAGED_PROVIDER_IDS = ['vllm', 'ollama'] as const

export type ManagedProviderId = (typeof MANAGED_PROVIDER_IDS)[number]

export type ManagedProviderConfig = {
  id: ManagedProviderId
  binaryName: string
  spawnModelRequired: boolean
}

export const managedProviderConfigs: Record<
  ManagedProviderId,
  ManagedProviderConfig
> = {
  vllm: {
    id: 'vllm',
    binaryName: 'vllm',
    spawnModelRequired: true,
  },
  ollama: {
    id: 'ollama',
    binaryName: 'ollama',
    spawnModelRequired: false,
  },
}

export function isManagedProvider(
  providerId: string
): providerId is ManagedProviderId {
  return MANAGED_PROVIDER_IDS.includes(providerId as ManagedProviderId)
}

export function getManagedProviderConfig(
  providerId: string
): ManagedProviderConfig | undefined {
  if (!isManagedProvider(providerId)) return undefined
  return managedProviderConfigs[providerId]
}
