import { atom } from 'jotai'

/**
 * Store active right panel
 */
export const showRightSidePanelAtom = atom<boolean>(true)

/**
 * Store tabs menu active state
 */
export const activeTabThreadRightPanelAtom = atom<string>('assistant')
