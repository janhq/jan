/**
 * Keyboard Shortcut Types
 * Defines semantic actions and shortcut specifications
 */

export enum ShortcutAction {
  NEW_CHAT = 'newChat',
<<<<<<< HEAD
  TOGGLE_SIDEBAR = 'toggleSidebar',
  GO_TO_SETTINGS = 'goSettings',
=======
  NEW_PROJECT = 'newProject',
  TOGGLE_SIDEBAR = 'toggleSidebar',
  GO_TO_SETTINGS = 'goSettings',
  SEARCH = 'search',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  ZOOM_IN = 'zoomIn',
  ZOOM_OUT = 'zoomOut',
}

export interface ShortcutSpec {
  key: string
  usePlatformMetaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

export type ShortcutMap = Record<ShortcutAction, ShortcutSpec>
