import { EngineConfig, Engines } from '@janhq/core'
import { atom } from 'jotai'

/**
 * Store all of the installed engines including local and remote engines
 */
export const installedEnginesAtom = atom<Engines>()
