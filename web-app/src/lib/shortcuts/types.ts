/**
 * Keyboard Shortcut Types
 * Defines semantic actions and shortcut specifications
 */

export enum ShortcutAction {
  NEW_CHAT = 'newChat',
  NEW_PROJECT = 'newProject',
  TOGGLE_SIDEBAR = 'toggleSidebar',
  GO_TO_SETTINGS = 'goSettings',
  SEARCH = 'search',
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
