/**
 * Mobile Core Service - Android/iOS implementation
 *
 * This service extends TauriCoreService but provides mobile-specific
 * extension loading. Instead of reading extensions from the filesystem,
 * it returns pre-bundled web extensions.
 */

import { TauriCoreService } from './tauri'
import type { ExtensionManifest } from '@/lib/extension'
import JanConversationalExtension from '@janhq/conversational-extension'

export class MobileCoreService extends TauriCoreService {
  /**
   * Override getActiveExtensions to return pre-loaded web extensions
   * for mobile platforms where filesystem access is restricted.
   */
  async getActiveExtensions(): Promise<ExtensionManifest[]> {

    // Return conversational extension as a pre-loaded instance
    const conversationalExt = new JanConversationalExtension(
      'built-in',
      '@janhq/conversational-extension',
      'Conversational Extension',
      true,
      'Manages conversation threads and messages',
      '1.0.0'
    )

    const extensions: ExtensionManifest[] = [
      {
        name: '@janhq/conversational-extension',
        productName: 'Conversational Extension',
        url: 'built-in', // Not loaded from file, but bundled
        active: true,
        description: 'Manages conversation threads and messages',
        version: '1.0.0',
        extensionInstance: conversationalExt, // Pre-instantiated!
      },
    ]

    return extensions
  }

  /**
   * Mobile-specific install extensions implementation
   * On mobile, extensions are pre-bundled, so this is a no-op
   */
  async installExtensions(): Promise<void> {
    console.log('[Mobile] Extensions are pre-bundled, skipping installation')
    // No-op on mobile - extensions are built-in
  }
}
