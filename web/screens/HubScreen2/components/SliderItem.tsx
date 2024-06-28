import React, { useCallback, useMemo } from 'react'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'

import { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import { setDownloadLocalModelStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { setModelHubSelectedModelHandle } from '@/helpers/atoms/Model.atom'
import { setRemoteModelSetUpStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

type Props = {
  model: HuggingFaceModelEntry
}

const SliderItem: React.FC<Props> = ({ model }) => {
  const setDownloadLocalModelStage = useSetAtom(setDownloadLocalModelStageAtom)
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const setSelectedModelHandle = useSetAtom(setModelHubSelectedModelHandle)

  const isLocalModel = useMemo(() => !model.model, [model.model])

  const onActionButtonClicked = useCallback(() => {
    if (isLocalModel) {
      setSelectedModelHandle(model.name)
      setDownloadLocalModelStage('MODEL_LIST')
    } else {
      setRemoteModelSetUpStage('SETUP_INTRO')
    }
  }, [
    model,
    isLocalModel,
    setSelectedModelHandle,
    setDownloadLocalModelStage,
    setRemoteModelSetUpStage,
  ])

  const actionButtonLabel = isLocalModel ? 'Download' : 'Setup'

  return (
    <div className="flex justify-between rounded-2xl border border-[hsla(var(--app-border))] p-4">
      <div className="flex flex-col gap-1.5">
        <span>{model.name}</span>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full bg-green-400" />
          <span>subtitle</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-4">
        <div className="h-12 w-12 rounded-full bg-red-400" />
        <Button onClick={onActionButtonClicked}>{actionButtonLabel}</Button>
      </div>
    </div>
  )
}

export default SliderItem
