import { atom } from 'jotai'

import { atomWithStorage } from 'jotai/utils'

import { MainViewState } from '@/constants/screens'

export const mainViewStateAtom = atom<MainViewState>(MainViewState.Thread)

export const defaultJanDataFolderAtom = atom<string>('')

export const LocalEngineDefaultVariantAtom = atom<string>('')

export const RecommendEngineVariantAtom = atomWithStorage<string>(
  'recommendEngineVariant',
  '',
  undefined,
  { getOnInit: true }
)

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
export const appUpdateAvailableAtom = atom<boolean>(false)
export const appUpdateNotAvailableAtom = atom<boolean>(false)

const COPY_OVER_INSTRUCTION_ENABLED = 'copy_over_instruction_enabled'

export const copyOverInstructionEnabledAtom = atomWithStorage(
  COPY_OVER_INSTRUCTION_ENABLED,
  false
)

/**
 * App Banner Hub Atom - storage last banner setting - default undefined
 */
const appBannerHubStorageAtom = atomWithStorage<string | undefined>(
  'appBannerHub',
  undefined,
  undefined,
  {
    getOnInit: true,
  }
)
/**
 * App Hub Banner configured image - Retrieve from appBannerHubStorageAtom - fallback a random banner
 */
export const getAppBannerHubAtom = atom<string>(
  (get) =>
    get(appBannerHubStorageAtom) ??
    `./images/HubBanner/banner-${Math.floor(Math.random() * 30) + 1}.jpg`
)

/**
 * Set App Hub Banner - store in appBannerHubStorageAtom
 */
export const setAppBannerHubAtom = atom(null, (get, set, banner: string) => {
  set(appBannerHubStorageAtom, banner)
})
