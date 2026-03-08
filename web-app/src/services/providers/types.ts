/**
 * Providers Service Types
 */

export interface ProvidersService {
  getProviders(): Promise<ModelProvider[]>
  fetchModelsFromProvider(provider: ModelProvider): Promise<string[]>
  updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void>
  fetch(): typeof fetch
}
