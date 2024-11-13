import React, { useCallback, useRef, useState } from 'react'

import { ModelImportOption } from '@janhq/core'
import { Button, Modal, ModalClose } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import useImportModel, {
  getImportModelStageAtom,
  setImportModelStageAtom,
} from '@/hooks/useImportModel'

import ImportModelOptionSelection from './ImportModelOptionSelection'

import { importingModelsAtom } from '@/helpers/atoms/Model.atom'

const importOptions: ModelImportOption[] = [
  {
    type: 'symlink',
    title: 'Keep Original Files & Symlink',
    description:
      'You maintain your model files outside of Jan. Keeping your files where they are, and Jan will create a smart link to them.',
  },
  {
    type: 'copy',
    title: 'Move model binary file',
    description:
      'Jan will move your model binary file from your current folder into Jan Data Folder.',
  },
]

const ImportModelOptionModal = () => {
  const importingModels = useAtomValue(importingModelsAtom)
  const importStage = useAtomValue(getImportModelStageAtom)
  const setImportStage = useSetAtom(setImportModelStageAtom)
  const { importModels } = useImportModel()

  const [importOption, setImportOption] = useState(importOptions[0])
  const destinationModal = useRef<'NONE' | 'IMPORTING_MODEL'>('NONE')

  const onCancelClick = useCallback(() => {
    setImportStage('NONE')
  }, [setImportStage])

  const onContinueClick = useCallback(() => {
    importModels(importingModels, importOption.type)
    setImportStage('IMPORTING_MODEL')
  }, [importingModels, importOption, setImportStage, importModels])

  return (
    <Modal
      open={importStage === 'MODEL_SELECTED'}
      onOpenChange={() => {
        if (destinationModal.current === 'NONE') {
          setImportStage('NONE')
        } else {
          onContinueClick()
        }
      }}
      title="How would you like Jan to handle your models?"
      content={
        <div className="mt-4">
          {importOptions.map((option) => (
            <ImportModelOptionSelection
              key={option.type}
              option={option}
              checked={importOption.type === option.type}
              setSelectedOptionType={() => setImportOption(option)}
            />
          ))}
          <div className="mt-4 flex justify-end gap-x-2">
            <ModalClose asChild onClick={onCancelClick}>
              <Button theme="ghost">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                autoFocus
                onClick={() => {
                  destinationModal.current = 'IMPORTING_MODEL'
                }}
              >
                Continue Importing
              </Button>
            </ModalClose>
          </div>
        </div>
      }
    />
  )
}

export default ImportModelOptionModal
