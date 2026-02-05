/**
 * Deep Link Service Types
 * Types for handling deep link operations
 */

export interface DeepLinkService {
  onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>
  getCurrent(): Promise<string[]>
}
