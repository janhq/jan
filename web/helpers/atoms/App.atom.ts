import { atom } from 'jotai'

import { atomWithStorage } from 'jotai/utils'

import { MainViewState } from '@/constants/screens'

export const mainViewStateAtom = atom<MainViewState>(MainViewState.Thread)

export const defaultJanDataFolderAtom = atom<string>('')

const SHOW_RIGHT_PANEL = 'showRightPanel'

// Store panel atom
export const showLeftPanelAtom = atom<boolean>(true)

export const showRightPanelAtom = atomWithStorage<boolean>(
  SHOW_RIGHT_PANEL,
  false,
  undefined,
  { getOnInit: true }
)

export const showSystemMonitorPanelAtom = atom<boolean>(false)
export const appDownloadProgressAtom = atom<number>(-1)
export const updateVersionErrorAtom = atom<string | undefined>(undefined)

const COPY_OVER_INSTRUCTION_ENABLED = 'copy_over_instruction_enabled'

export const copyOverInstructionEnabledAtom = atomWithStorage(
  COPY_OVER_INSTRUCTION_ENABLED,
  false
)
