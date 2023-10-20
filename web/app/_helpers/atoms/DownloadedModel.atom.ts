import { AssistantModel } from '@/_models/AssistantModel'
import { atom } from 'jotai'

/**
 * @description: This atom is used to store the downloaded models
 */
export const downloadedModelAtom = atom<AssistantModel[]>([])
