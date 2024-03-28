import { atom } from 'jotai'

import { SettingScreen } from '@/screens/Settings'

export const selectedSettingAtom = atom<SettingScreen | string>('My Models')

export const janSettingScreenAtom = atom<SettingScreen[]>([])
