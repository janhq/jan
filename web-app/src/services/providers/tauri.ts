/**
 * Tauri Providers Service - Desktop implementation
 * 
 * Currently uses default implementation as providers are handled through ExtensionManager and Tauri fetch
 */

import { DefaultProvidersService } from './default'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'

export class TauriProvidersService extends DefaultProvidersService {
  getTauriFetch(): typeof fetch {
    // Tauri implementation uses Tauri's fetch to avoid CORS issues
    return fetchTauri as typeof fetch
  }
}