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
   * Override: Return pre-bundled extensions instead of reading from filesystem
   */
  override async getActiveExtensions(): Promise<ExtensionManifest[]> {
    return this.getBundledExtensions()
  }

  /**
   * Override: No-op on mobile - extensions are pre-bundled in the app
   */
  override async installExtensions(): Promise<void> {
    console.log('[Mobile] Extensions are pre-bundled, skipping installation')
  }

  /**
   * Override: No-op on mobile - cannot install additional extensions
   */
  override async installExtension(): Promise<ExtensionManifest[]> {
    console.log('[Mobile] Cannot install extensions on mobile, they are pre-bundled')
    return this.getBundledExtensions()
  }

  /**
   * Override: No-op on mobile - cannot uninstall bundled extensions
   */
  override async uninstallExtension(): Promise<boolean> {
    console.log('[Mobile] Cannot uninstall pre-bundled extensions on mobile')
    return false
  }

  /**
   * Private method to return pre-bundled mobile extensions
   */
  private getBundledExtensions(): ExtensionManifest[] {
    const conversationalExt = new JanConversationalExtension(
      'built-in',
      '@janhq/conversational-extension',
      'Conversational Extension',
      true,
      'Manages conversation threads and messages',
      '1.0.0'
    )

    return [
      {
        name: '@janhq/conversational-extension',
        productName: 'Conversational Extension',
        url: 'built-in',
        active: true,
        description: 'Manages conversation threads and messages',
        version: '1.0.0',
        extensionInstance: conversationalExt,
      },
    ]
  }
}
