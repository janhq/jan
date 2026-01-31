/**
 * Shortcuts Configuration
 * Centralized shortcut definitions based on platform capabilities
 */

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
  [ShortcutAction.NEW_CHAT]: { key: 'n', usePlatformMetaKey: true },

  // New project - opens create project dialog
  [ShortcutAction.NEW_PROJECT]: { key: 'p', usePlatformMetaKey: true },

  // Go to settings - different per platform to avoid browser "preferences" conflict
  [ShortcutAction.GO_TO_SETTINGS]: { key: ',', usePlatformMetaKey: true },

  // Search - opens search dialog
  [ShortcutAction.SEARCH]: { key: 'k', usePlatformMetaKey: true },

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
