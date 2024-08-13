import { Fragment, useCallback, useMemo } from 'react'

import React from 'react'

import Image from 'next/image'

import { EngineStatus, RemoteEngine } from '@janhq/core'
import { Button } from '@janhq/joi'

import { useSetAtom } from 'jotai'
import { Settings } from 'lucide-react'

import useEngineQuery from '@/hooks/useEngineQuery'

import { HfModelEntry } from '@/utils/huggingface'

import { getLogoByRemoteEngine, getTitleByCategory } from '@/utils/model-engine'

import RemoteModelCard from './RemoteModelCard'

import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

type Props = {
  data: HfModelEntry[]
  engine: RemoteEngine
  onSeeAllClick: () => void
}

const RemoteModelGroup: React.FC<Props> = ({ data, engine, onSeeAllClick }) => {
  const { data: engineData } = useEngineQuery()
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  const apiKeyUrl: string | undefined = data.find(
    (entry) => entry.model?.metadata?.api_key_url != null
  )?.model?.metadata?.api_key_url

  const remoteEngineLogo = getLogoByRemoteEngine(engine as RemoteEngine)

  // get maximum 4 items
  const models = data.slice(0, 4)
  const showSeeAll = models.length < data.length
  const refinedTitle = getTitleByCategory(engine)

  const isHasApiKey = useMemo(
    () =>
      engineData == null || engine == null
        ? false
        : engineData.find((e) => e.name === engine)?.status ===
          EngineStatus.Ready,
    [engineData, engine]
  )

  const onSetUpClick = useCallback(() => {
    setUpRemoteModelStage('SETUP_API_KEY', engine, {
      logo: remoteEngineLogo,
      api_key_url: apiKeyUrl,
    })
  }, [setUpRemoteModelStage, engine, remoteEngineLogo, apiKeyUrl])

  return (
    <Fragment>
      <div className="mt-12 flex items-center gap-2 first:mt-0">
        {remoteEngineLogo && (
          <Image
            width={24}
            height={24}
            src={remoteEngineLogo}
            alt="Engine logo"
            className="rounded-full"
          />
        )}
        <h1 className="text-lg font-semibold">{refinedTitle}</h1>

        {isHasApiKey ? (
          <Button theme="icon" onClick={onSetUpClick}>
            <Settings size={16} />
          </Button>
        ) : (
          <Button
            theme="ghost"
            size="small"
            className="bg-[hsla(var(--secondary-bg))]"
            onClick={onSetUpClick}
          >
            Set Up
          </Button>
        )}

        {showSeeAll && (
          <Button
            theme="ghost"
            onClick={onSeeAllClick}
            className="ml-auto pr-0 text-sm text-[hsla(var(--app-link))]"
          >
            See All
          </Button>
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-20 md:grid-cols-2">
        {models.map((model) => (
          <RemoteModelCard key={model.name} {...model} />
        ))}
      </div>
    </Fragment>
  )
}

export default React.memo(RemoteModelGroup)
