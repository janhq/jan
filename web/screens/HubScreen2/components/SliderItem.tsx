import React, { useCallback } from 'react'

import Image from 'next/image'

import { Button } from '@janhq/joi'

import { QuickStartModel } from '@/hooks/useModelHub'

type Props = {
  model: QuickStartModel
}

const SliderItem: React.FC<Props> = ({ model }) => {
  const onActionButtonClicked = useCallback(
    () => {
      // TODO: NamH
      // if (isLocalModel) {
      //   setSelectedModelHandle(model.name)
      //   setDownloadLocalModelStage('MODEL_LIST')
      // } else {
      //   setRemoteModelSetUpStage('SETUP_INTRO')
      // }
    },
    [
      // model,
      // isLocalModel,
      // setSelectedModelHandle,
      // setDownloadLocalModelStage,
      // setRemoteModelSetUpStage,
    ]
  )

  const shouldShowOwnerLogo =
    model.owner_logo !== undefined && model.owner_logo !== ''

  return (
    <div className="flex justify-between rounded-2xl border border-[hsla(var(--app-border))] p-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-semibold leading-6">
          {model.model_name}
        </span>
        <div className="flex items-center gap-1.5">
          {shouldShowOwnerLogo && (
            <Image
              width={20}
              height={20}
              src={model.owner_logo}
              alt={model.owner_name}
            />
          )}
          <span className="text-sm font-medium leading-4">
            {model.owner_name}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-4">
        <div className="h-12 w-12 rounded-full bg-transparent" />
        <Button onClick={onActionButtonClicked}>Download</Button>
      </div>
    </div>
  )
}

export default SliderItem
