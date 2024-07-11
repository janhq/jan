import { Fragment, useCallback, useMemo } from 'react'

import React from 'react'

import Image from 'next/image'

import { RemoteEngine } from '@janhq/core'
import { Button } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { Settings } from 'lucide-react'

import { HfModelEntry } from '@/utils/huggingface'

import { getTitleByCategory } from '@/utils/model-engine'

import RemoteModelCard from './RemoteModelCard'

import { getCortexConfigAtom } from '@/helpers/atoms/CortexConfig.atom'
import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

type Props = {
  data: HfModelEntry[]
  engine: RemoteEngine
  onSeeAllClick: () => void
}

const RemoteModelGroup: React.FC<Props> = ({ data, engine, onSeeAllClick }) => {
  const cortexConfig = useAtomValue(getCortexConfigAtom)
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  const engineLogo: string | undefined = data.find(
    (entry) => entry.model?.metadata?.owner_logo != null
  )?.model?.metadata?.owner_logo

  const apiKeyUrl: string | undefined = data.find(
    (entry) => entry.model?.metadata?.api_key_url != null
  )?.model?.metadata?.api_key_url

  // get maximum 4 items
  const models = data.slice(0, 4)
  const showSeeAll = models.length < data.length
  const refinedTitle = getTitleByCategory(engine)

  const isHasApiKey = useMemo(() => {
    // @ts-expect-error engine is not null
    return (cortexConfig[engine ?? '']?.apiKey ?? '').length > 0
  }, [cortexConfig, engine])

  const onSetUpClick = useCallback(() => {
    setUpRemoteModelStage('SETUP_API_KEY', engine, {
      owner_logo: engineLogo,
      api_key_url: apiKeyUrl,
    })
  }, [setUpRemoteModelStage, engine, engineLogo, apiKeyUrl])

  return (
    <Fragment>
      <div className="mt-12 flex items-center gap-2 first:mt-0">
        {engineLogo && (
          <Image width={24} height={24} src={engineLogo} alt="Engine logo" />
        )}
        <h1 className="text-lg font-semibold">{refinedTitle}</h1>

        {isHasApiKey ? (
          <Button theme="icon" onClick={onSetUpClick}>
            <Settings size={16} />
          </Button>
        ) : (
          <Button
            className="ml-2 !bg-[#0000000F] px-3 py-2 text-xs text-[var(--text-primary)]"
            onClick={onSetUpClick}
          >
            Set Up
          </Button>
        )}

        {showSeeAll && (
          <Button
            theme="ghost"
            onClick={onSeeAllClick}
            className="ml-auto pr-0 text-sm text-[#2563EB]"
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
