import React, { useCallback, useMemo } from 'react'

import { LocalEngines } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'

import { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import BotName from './BotName'

import { setDownloadLocalModelStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { setModelHubSelectedModelHandle } from '@/helpers/atoms/ModelHub.atom'
import {
  setRemoteModelBeingSetUpAtom,
  setRemoteModelSetUpStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const HubModelCard: React.FC<HuggingFaceModelEntry> = ({
  name,
  downloads,
  likes,
  model,
}) => {
  const setDownloadLocalModelStage = useSetAtom(setDownloadLocalModelStageAtom)
  const setRemoteModelSetUpStage = useSetAtom(setRemoteModelSetUpStageAtom)
  const setRemoteModelBeingSetUp = useSetAtom(setRemoteModelBeingSetUpAtom)
  const setSelectedModelHandle = useSetAtom(setModelHubSelectedModelHandle)

  const isLocalModel = useMemo(
    () =>
      model == null ||
      LocalEngines.filter((e) => e === model.engine).length > 0,
    [model]
  )

  const onDownloadClick = useCallback(() => {
    if (isLocalModel) {
      setSelectedModelHandle(name)
      setDownloadLocalModelStage('MODEL_LIST')
    } else {
      setRemoteModelBeingSetUp(model!)
      setRemoteModelSetUpStage('SETUP_INTRO')
    }
  }, [
    setDownloadLocalModelStage,
    setSelectedModelHandle,
    setRemoteModelSetUpStage,
    setRemoteModelBeingSetUp,
    name,
    model,
    isLocalModel,
  ])
  const owner = model?.metadata?.owned_by ?? ''
  const logoUrl = model?.metadata?.owner_logo ?? ''

  return (
    <div className="flex flex-row justify-between border-b-[1px] border-[hsla(var(--app-border))] pb-3 pt-4 last:border-b-0">
      <div className="flex flex-col gap-2">
        <span>{name}</span>
        <BotName
          className="text-[hsla(var(--text-secondary)] my-4"
          name={owner}
          image={logoUrl}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button onClick={onDownloadClick}>
          {isLocalModel ? 'Download' : 'Setup'}
        </Button>
        <span>
          Download: {downloads} Likes: {likes}
        </span>
      </div>
    </div>
  )
}

export default HubModelCard
