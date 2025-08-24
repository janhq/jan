/**
 * Platform-Aware Extension Manager
 * Extends the base ExtensionManager to handle platform-specific extension loading
 */

import { ExtensionManager, ExtensionManifest } from '../extension'
import ConversationalExtensionWeb from '../../extensions/conversational-web'
import AssistantExtensionWeb from '../../extensions/assistant-web'
import { isPlatformTauri } from '@/lib/platform'

/**
 * Registry of web extensions
 * These are bundled with the web app instead of dynamically loaded
 */
const WEB_EXTENSIONS = {
  'conversational-web': ConversationalExtensionWeb,
  'assistant-web': AssistantExtensionWeb,
}

export class PlatformExtensionManager extends ExtensionManager {
  /**
   * Platform-aware extension registration
   * On web: pre-register bundled extensions
   * On desktop: use standard dynamic loading
   */
  async registerActive() {
    if (isPlatformTauri()) {
      // Desktop version: use standard dynamic extension loading
      await super.registerActive()
    } else {
      // Web version: register pre-bundled extensions
      console.log('Loading web extensions...')
      
      // Register conversational extension
      const conversationalExt = new WEB_EXTENSIONS['conversational-web']('web', 'conversational-web', 'Conversational Extension Web', true, 'Web version of conversational extension', '1.0.0')
      this.register('conversational-web', conversationalExt)
      await conversationalExt.onLoad()
      
      // Register assistant extension
      const assistantExt = new WEB_EXTENSIONS['assistant-web']('web', 'assistant-web', 'Assistant Extension Web', true, 'Web version of assistant extension', '1.0.0')
      this.register('assistant-web', assistantExt)
      await assistantExt.onLoad()
      
      console.log('Web extensions loaded successfully')
    }
  }

  /**
   * Platform-aware extension retrieval
   */
  async getActive() {
    if (isPlatformTauri()) {
      // Desktop version: get extensions from filesystem
      return await super.getActive()
    } else {
      // Web version: return empty array since extensions are pre-loaded
      return []
    }
  }

  /**
   * Platform-aware extension installation
   */
  async install(extensions: ExtensionManifest[]) {
    if (isPlatformTauri()) {
      // Desktop version: use standard installation
      return await super.install(extensions)
    } else {
      // Web version: installation not supported
      console.warn('Extension installation not supported in web version')
      return []
    }
  }

  /**
   * Platform-aware extension uninstallation
   */
  uninstall(extensions: string[], reload = true) {
    if (isPlatformTauri()) {
      // Desktop version: use standard uninstallation
      return super.uninstall(extensions, reload)
    } else {
      // Web version: uninstallation not supported
      console.warn('Extension uninstallation not supported in web version')
      return Promise.resolve(false)
    }
  }
}