/**
 * Mobile Core Service - Android/iOS implementation
 *
 * Extensions are bundled into the app; mobile exposes only the subset that has
 * no native plugin dependencies (see the `mobile` flag in bundled-extensions).
 */

import { TauriCoreService } from './tauri'
import type { ExtensionManifest } from '@/lib/extension'
import { getBundledExtensions } from './bundled-extensions'

export class MobileCoreService extends TauriCoreService {
  override async getActiveExtensions(): Promise<ExtensionManifest[]> {
    return getBundledExtensions({ mobile: true })
  }

  override async installExtensions(): Promise<void> {}

  override async installExtension(): Promise<ExtensionManifest[]> {
    return getBundledExtensions({ mobile: true })
  }

  override async uninstallExtension(): Promise<boolean> {
    return false
  }
}
