export class BackendPreferenceStore {
  constructor(
    private readonly logInfo: (...args: unknown[]) => void,
    private readonly logWarn: (...args: unknown[]) => void
  ) {}

  getStoredBackendType(): string | null {
    try {
      return localStorage.getItem('llama_cpp_backend_type')
    } catch (error) {
      this.logWarn('Failed to read backend type from localStorage:', error)
      return null
    }
  }

  setStoredBackendType(backendType: string): void {
    try {
      localStorage.setItem('llama_cpp_backend_type', backendType)
      this.logInfo(`Stored backend type preference: ${backendType}`)
    } catch (error) {
      this.logWarn('Failed to store backend type in localStorage:', error)
    }
  }

  clearStoredBackendType(): void {
    try {
      localStorage.removeItem('llama_cpp_backend_type')
      this.logInfo('Cleared stored backend type preference')
    } catch (error) {
      this.logWarn('Failed to clear backend type from localStorage:', error)
    }
  }
}
