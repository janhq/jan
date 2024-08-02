import { atom } from 'jotai'

export enum MainViewState {
  Hub,
  Settings,
  Thread,
  LocalServer,
}

export const mainViewStateAtom = atom<MainViewState>(MainViewState.Thread)

export const defaultJanDataFolderAtom = atom<string>('')

export const waitingForCortexAtom = atom<boolean>(true)

// Store panel atom
export const showLeftPanelAtom = atom<boolean>(true)
export const showRightPanelAtom = atom<boolean>(true)
export const showSystemMonitorPanelAtom = atom<boolean>(false)
export const appDownloadProgressAtom = atom<number>(-1)
export const updateVersionErrorAtom = atom<string | undefined>(undefined)
