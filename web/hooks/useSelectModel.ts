import { useCallback } from 'react'

import { Model } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { updateSelectedModelAtom } from '@/helpers/atoms/Model.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const useSelectModel = () => {
  const updateSelectedModel = useSetAtom(updateSelectedModelAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const { updateThread } = useCortex()

  const selectModel = useCallback(
    (model: Model) => {
      if (activeThread) {
        console.debug(
          `Set model id ${model.model} to active thread ${activeThread.id}`
        )
        activeThread.assistants[0].model = model.model
        updateThread(activeThread)
      }

      updateSelectedModel(model)
    },
    [activeThread, updateSelectedModel, updateThread]
  )

  return { selectModel }
}

export default useSelectModel
