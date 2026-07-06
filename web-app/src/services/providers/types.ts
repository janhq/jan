/**
 * Providers Service Types
 */

export interface ProvidersService {
  getProviders(): Promise<ModelProvider[]>
  fetchModelsFromProvider(provider: ModelProvider): Promise<string[]>
  updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void>
  /**
   * Permanently delete a provider's stored API key chain from the OS keyring.
   * Explicit, user-initiated only (provider removal / key clear) — never called
   * during boot reconciliation, which must not destroy stored secrets.
   */
  deleteProviderKeys(providerName: string): Promise<void>
  fetch(): typeof fetch
}
