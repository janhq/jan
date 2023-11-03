import { Model } from '@janhq/core/lib/types'
import { atom } from 'jotai'

/**
 * @description: This atom is used to store the downloaded models
 */
export const downloadedModelAtom = atom<Model[]>([])
