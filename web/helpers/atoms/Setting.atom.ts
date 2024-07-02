import { atom } from 'jotai'

import { atomWithStorage } from 'jotai/utils'

import { SettingScreen } from '@/screens/Settings'

export const selectedSettingAtom = atom<SettingScreen | string>('My Models')

export const janSettingScreenAtom = atom<SettingScreen[]>([])

export const THEME = 'themeAppearance'
export const REDUCE_TRANSPARENT = 'reduceTransparent'
export const SPELL_CHECKING = 'spellChecking'
export const themesOptionsAtom = atom<{ name: string; value: string }[]>([])
export const janThemesPathAtom = atom<string | undefined>(undefined)
export const selectedThemeIdAtom = atomWithStorage<string>(THEME, '')
export const themeDataAtom = atom<Theme | undefined>(undefined)
export const reduceTransparentAtom = atomWithStorage<boolean>(
  REDUCE_TRANSPARENT,
  false
)
export const spellCheckAtom = atomWithStorage<boolean>(SPELL_CHECKING, true)
