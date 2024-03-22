import { useCallback } from 'react'

import {
  ExtensionTypeEnum,
  ImportingModel,
  Model,
  ModelExtension,
  OptionType,
} from '@janhq/core'

import { atom } from 'jotai'

import { extensionManager } from '@/extension'

export type ImportModelStage =
  | 'NONE'
  | 'SELECTING_MODEL'
  | 'MODEL_SELECTED'
  | 'IMPORTING_MODEL'
  | 'EDIT_MODEL_INFO'
  | 'CONFIRM_CANCEL'

const importModelStageAtom = atom<ImportModelStage>('NONE')

export const getImportModelStageAtom = atom((get) => get(importModelStageAtom))

export const setImportModelStageAtom = atom(
  null,
  (_get, set, stage: ImportModelStage) => {
    set(importModelStageAtom, stage)
  }
)

export type ModelUpdate = {
  name: string
  description: string
  tags: string[]
}

const useImportModel = () => {
  const importModels = useCallback(
    (models: ImportingModel[], optionType: OptionType) =>
      localImportModels(models, optionType),
    []
  )

  const updateModelInfo = useCallback(
    async (modelInfo: Partial<Model>) => localUpdateModelInfo(modelInfo),
    []
  )

  return { importModels, updateModelInfo }
}

const localImportModels = async (
  models: ImportingModel[],
  optionType: OptionType
): Promise<void> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.importModels(models, optionType)

const localUpdateModelInfo = async (
  modelInfo: Partial<Model>
): Promise<Model | undefined> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.updateModelInfo(modelInfo)

export default useImportModel
