import React, { useCallback } from 'react'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'

import { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import { setDownloadLocalModelStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { setModelHubSelectedModelHandle } from '@/helpers/atoms/ModelHub.atom'

const HubModelCard: React.FC<HuggingFaceModelEntry> = ({
  name,
  downloads,
  likes,
}) => {
  const setDownloadLocalModelStage = useSetAtom(setDownloadLocalModelStageAtom)
  const setSelectedModelHandle = useSetAtom(setModelHubSelectedModelHandle)

  const onDownloadClick = useCallback(() => {
    setSelectedModelHandle(name)
    setDownloadLocalModelStage('MODEL_LIST')
  }, [setDownloadLocalModelStage, setSelectedModelHandle, name])

  return (
    <div className="flex flex-row justify-between border-b-[1px] border-[hsla(var(--app-border))] pb-3 pt-4 last:border-b-0">
      <div className="flex flex-col gap-2">
        <span>{name}</span>
        <span>Model 1 Subtitle</span>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button onClick={onDownloadClick}>Download</Button>
        <span>
          Download: {downloads} Likes: {likes}
        </span>
      </div>
    </div>
  )
}

export default HubModelCard
