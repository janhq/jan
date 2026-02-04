/**
 * Shortcuts Configuration
 * Centralized shortcut definitions based on platform capabilities
 */

<<<<<<< HEAD
import { PlatformFeatures } from '../platform/const'
import { PlatformFeature } from '../platform/types'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { ShortcutAction, type ShortcutMap } from './types'

/**
 * Platform-specific shortcut mappings
 * Uses alternate bindings for web to avoid browser conflicts
 */
export const PlatformShortcuts: ShortcutMap = {
  // Toggle sidebar - same on both platforms (no browser conflict)
  [ShortcutAction.TOGGLE_SIDEBAR]: {
    key: 'b',
    usePlatformMetaKey: true,
  },

  // New chat - different per platform to avoid browser "new window" conflict
<<<<<<< HEAD
  [ShortcutAction.NEW_CHAT]: PlatformFeatures[PlatformFeature.ALTERNATE_SHORTCUT_BINDINGS]
    ? { key: 'Enter', usePlatformMetaKey: true }
    : { key: 'n', usePlatformMetaKey: true },

  // Go to settings - different per platform to avoid browser "preferences" conflict
  [ShortcutAction.GO_TO_SETTINGS]: PlatformFeatures[PlatformFeature.ALTERNATE_SHORTCUT_BINDINGS]
    ? { key: '.', usePlatformMetaKey: true }
    : { key: ',', usePlatformMetaKey: true },
=======
  [ShortcutAction.NEW_CHAT]: { key: 'n', usePlatformMetaKey: true },

  // New project - opens create project dialog
  [ShortcutAction.NEW_PROJECT]: { key: 'p', usePlatformMetaKey: true },

  // Go to settings - different per platform to avoid browser "preferences" conflict
  [ShortcutAction.GO_TO_SETTINGS]: { key: ',', usePlatformMetaKey: true },

  // Search - opens search dialog
  [ShortcutAction.SEARCH]: { key: 'k', usePlatformMetaKey: true },
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  // Zoom shortcuts - same on both platforms (standard shortcuts)
  [ShortcutAction.ZOOM_IN]: {
    key: '+',
    usePlatformMetaKey: true,
  },

  [ShortcutAction.ZOOM_OUT]: {
    key: '-',
    usePlatformMetaKey: true,
  },
}
