/**
 * Tauri Core Service - Desktop implementation
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type { ExtensionManifest } from '@/lib/extension'
import type { InvokeArgs } from './types'
import { DefaultCoreService } from './default'
import { getBundledExtensions } from './bundled-extensions'

export class TauriCoreService extends DefaultCoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    try {
      return await invoke<T>(command, args)
    } catch (error) {
      console.error(`Error invoking Tauri command '${command}' in Tauri:`, error)
      throw error
    }
  }

  convertFileSrc(filePath: string, protocol?: string): string {
    try {
      return convertFileSrc(filePath, protocol)
    } catch (error) {
      console.error('Error converting file src in Tauri:', error)
      return filePath
    }
  }

  // Built-in extensions are bundled into the app binary; user-installed
  // third-party extensions are still discovered on disk.
  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    const bundled = await getBundledExtensions()
    const userInstalled = await this.getUserInstalledExtensions(
      new Set(bundled.map((e) => e.name))
    )
    return [...bundled, ...userInstalled]
  }

  // Built-ins are bundled, so there is no filesystem install step.
  async installExtensions(): Promise<void> {}

  async installExtension(): Promise<ExtensionManifest[]> {
    return this.getActiveExtensions()
  }

  async uninstallExtension(): Promise<boolean> {
    return false
  }

  /**
   * Reads third-party extensions registered in
   * `<janDataFolder>/extensions/extensions.json`. Entries without a loadable
   * entrypoint or whose name collides with a bundled extension are skipped —
   * the bundled build wins, since on-disk copies of built-ins are stale
   * leftovers from before the bundling migration.
   */
  private async getUserInstalledExtensions(
    bundledNames: Set<string>
  ): Promise<ExtensionManifest[]> {
    try {
      const dataFolder = await this.invoke<string>('get_jan_data_folder_path')
      if (!dataFolder) return []
      const manifestPath = `${dataFolder}/extensions/extensions.json`
      if (
        !(await this.invoke<boolean>('exists_sync', { args: [manifestPath] }))
      ) {
        return []
      }
      const raw = await this.invoke<string>('read_file_sync', {
        args: [manifestPath],
      })
      const entries: unknown = JSON.parse(raw)
      if (!Array.isArray(entries)) return []
      return entries
        .filter(
          (ext): ext is Record<string, unknown> =>
            !!ext &&
            typeof ext === 'object' &&
            typeof ext.name === 'string' &&
            ext.name.length > 0 &&
            typeof ext.url === 'string' &&
            ext.url.length > 0 &&
            !bundledNames.has(ext.name)
        )
        .map((ext) => ({
          url: ext.url as string,
          name: ext.name as string,
          productName:
            typeof ext.productName === 'string' ? ext.productName : undefined,
          // "active" first, then the legacy "_active" flag, defaulting to
          // true — the same precedence the removed native command used.
          active:
            typeof ext.active === 'boolean'
              ? ext.active
              : typeof ext._active === 'boolean'
                ? ext._active
                : true,
          description:
            typeof ext.description === 'string' ? ext.description : undefined,
          version: typeof ext.version === 'string' ? ext.version : undefined,
        }))
    } catch (error) {
      console.error('Failed to read user-installed extensions:', error)
      return []
    }
  }

  // App token
  async getAppToken(): Promise<string | null> {
    try {
      const result = await this.invoke<string | null>('app_token')
      return result
    } catch (error) {
      console.error('Error getting app token in Tauri:', error)
      return null
    }
  }
}
