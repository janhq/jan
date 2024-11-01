import { useCallback } from 'react'

import {
  ExtensionTypeEnum,
  ImportingModel,
  Model,
  ModelEvent,
  ModelExtension,
  OptionType,
  events,
  fs,
} from '@janhq/core'

import { atom, useSetAtom } from 'jotai'

import { v4 as uuidv4 } from 'uuid'

import { snackbar } from '@/containers/Toast'

import { FilePathWithSize } from '@/utils/file'

import { extensionManager } from '@/extension'
import {
  addDownloadingModelAtom,
  importingModelsAtom,
  removeDownloadingModelAtom,
} from '@/helpers/atoms/Model.atom'

export type ImportModelStage =
  | 'NONE'
  | 'SELECTING_MODEL'
  | 'CHOOSE_WHAT_TO_IMPORT'
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
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const setImportingModels = useSetAtom(importingModelsAtom)
  const addDownloadingModel = useSetAtom(addDownloadingModelAtom)
  const removeDownloadingModel = useSetAtom(removeDownloadingModelAtom)

  const importModels = useCallback(
    (models: ImportingModel[], optionType: OptionType) => {
      models.map((model) => {
        const modelId = model.modelId ?? model.path.split('/').pop()
        if (modelId) {
          addDownloadingModel(modelId)
          extensionManager
            .get<ModelExtension>(ExtensionTypeEnum.Model)
            ?.importModel(modelId, model.path, model.name)
            .finally(() => {
              removeDownloadingModel(modelId)
              events.emit(ModelEvent.OnModelsUpdate, {})
            })
        }
      })
    },
    [addDownloadingModel, removeDownloadingModel]
  )

  const updateModelInfo = useCallback(
    async (modelInfo: Partial<Model>) => localUpdateModelInfo(modelInfo),
    []
  )

  const sanitizeFilePaths = useCallback(
    async (filePaths: string[]) => {
      if (!filePaths || filePaths.length === 0) return
      const { unsupportedFiles, supportedFiles } = (await fs.getGgufFiles(
        filePaths
      )) as unknown as {
        unsupportedFiles: FilePathWithSize[]
        supportedFiles: FilePathWithSize[]
      }

      const importingModels: ImportingModel[] = supportedFiles.map(
        ({ path, name, size }: FilePathWithSize) => ({
          importId: uuidv4(),
          modelId: undefined,
          name: name.replace('.gguf', ''),
          description: '',
          path: path,
          tags: [],
          size: size,
          status: 'PREPARING',
          format: 'gguf',
        })
      )
      if (unsupportedFiles.length > 0) {
        snackbar({
          description: `Only files with .gguf extension can be imported.`,
          type: 'error',
        })
      }
      if (importingModels.length === 0) return

      setImportingModels(importingModels)
      setImportModelStage('MODEL_SELECTED')
    },
    [setImportModelStage, setImportingModels]
  )

  return { importModels, updateModelInfo, sanitizeFilePaths }
}

const localUpdateModelInfo = async (
  modelInfo: Partial<Model>
): Promise<Model | undefined> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.updateModel(modelInfo)

export default useImportModel
