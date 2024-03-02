import { useCallback, useEffect, useState } from 'react'

import {
  Model,
  ModelEvent,
  events,
  joinPath,
  openFileExplorer,
} from '@janhq/core'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  ModalClose,
  Button,
  Input,
  Textarea,
} from '@janhq/uikit'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { Paperclip } from 'lucide-react'

import useImportModel, {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

import { toGibibytes } from '@/utils/converter'

import { openFileTitle } from '@/utils/titleUtils'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  importingModelsAtom,
  updateImportingModelAtom,
} from '@/helpers/atoms/Model.atom'

export const editingModelIdAtom = atom<string | undefined>(undefined)

const EditModelInfoModal: React.FC = () => {
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const importingModels = useAtomValue(importingModelsAtom)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const [editingModelId, setEditingModelId] = useAtom(editingModelIdAtom)

  const [modelName, setModelName] = useState('')
  const [modelId, setModelId] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])

  const janDataFolder = useAtomValue(janDataFolderPathAtom)
  const updateImportingModel = useSetAtom(updateImportingModelAtom)
  const { updateModelInfo } = useImportModel()
  const [modelPath, setModelPath] = useState<string>('')

  const editingModel = importingModels.find(
    (model) => model.importId === editingModelId
  )

  useEffect(() => {
    if (editingModel && editingModel.modelId != null) {
      setModelName(editingModel.name)
      setModelId(editingModel.modelId)
      setDescription(editingModel.description)
      setTags(editingModel.tags)
    }
  }, [editingModel])

  const onCancelClick = () => {
    setImportModelStage('IMPORTING_MODEL')
    setEditingModelId(undefined)
  }

  const onSaveClick = async () => {
    if (!editingModel || !editingModel.modelId) return

    const modelInfo: Partial<Model> = {
      id: editingModel.modelId,
      name: modelName,
      description,
      metadata: {
        author: 'User',
        tags,
        size: 0,
      },
    }

    await updateModelInfo(modelInfo)
    events.emit(ModelEvent.OnModelsUpdate, {})
    updateImportingModel(editingModel.importId, modelName, description, tags)

    setImportModelStage('IMPORTING_MODEL')
    setEditingModelId(undefined)
  }

  useEffect(() => {
    const getModelPath = async () => {
      const modelId = editingModel?.modelId
      if (!modelId) return ''
      const path = await joinPath([janDataFolder, 'models', modelId])
      setModelPath(path)
    }
    getModelPath()
  }, [janDataFolder, editingModel])

  const onShowInFinderClick = useCallback(() => {
    openFileExplorer(modelPath)
  }, [modelPath])

  if (!editingModel) {
    setImportModelStage('IMPORTING_MODEL')
    setEditingModelId(undefined)

    return null
  }

  return (
    <Modal
      open={importModelStage === 'EDIT_MODEL_INFO'}
      onOpenChange={onCancelClick}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Edit Model Information</ModalTitle>
        </ModalHeader>

        <div className="flex flex-row space-x-4 rounded-xl border p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-400">
            <Paperclip />
          </div>

          <div className="flex flex-col">
            <p>{editingModel.name}</p>
            <div className="flex flex-row">
              <span className="mr-2 text-sm text-[#71717A]">
                {toGibibytes(editingModel.size)}
              </span>
              <span className="text-sm font-semibold text-[#71717A]">
                Format:{' '}
              </span>
              <span className="text-sm font-normal text-[#71717A]">
                {editingModel.format.toUpperCase()}
              </span>
            </div>
            <div className="mt-1 flex flex-row items-center space-x-2">
              <span className="line-clamp-1 text-xs font-normal text-[#71717A]">
                {modelPath}
              </span>
              <Button themes="ghost" onClick={onShowInFinderClick}>
                {openFileTitle()}
              </Button>
            </div>
          </div>
        </div>

        <form className="flex flex-col space-y-4">
          <div className="flex flex-col">
            <label className="mb-1">Model Name</label>
            <Input
              value={modelName}
              onChange={(e) => {
                e.preventDefault()
                setModelName(e.target.value)
              }}
            />
          </div>
          <div className="flex flex-col">
            <label className="mb-1">Model ID</label>
            <Input
              disabled
              value={modelId}
              onChange={(e) => {
                e.preventDefault()
                setModelId(e.target.value)
              }}
            />
          </div>
          <div className="flex flex-col">
            <label className="mb-1">Description</label>
            <Textarea
              value={description}
              onChange={(e) => {
                e.preventDefault()
                setDescription(e.target.value)
              }}
            />
          </div>
          <div className="flex flex-col">
            <label className="mb-1">Tags</label>
            <Input />
          </div>
        </form>

        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild onClick={onCancelClick}>
              <Button themes="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button autoFocus themes="primary" onClick={onSaveClick}>
                Save
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditModelInfoModal
