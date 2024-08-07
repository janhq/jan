import { useCallback, useMemo } from 'react'

import Image from 'next/image'

import { EngineStatus, RemoteEngine, RemoteEngines } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { Settings } from 'lucide-react'

import useEngineQuery from '@/hooks/useEngineQuery'
import { ModelHubCategory } from '@/hooks/useModelHub'

import {
  getDescriptionByCategory,
  getTitleByCategory,
} from '@/utils/model-engine'

import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

type Props = {
  category: ModelHubCategory
  imageUrl?: string
  apiKeyUrl?: string
}

const GroupInfo: React.FC<Props> = ({ category, imageUrl, apiKeyUrl }) => {
  const title = getTitleByCategory(category)
  const description = getDescriptionByCategory(category)

  const remoteEngine = RemoteEngines.find((engine) => engine === category)

  return (
    <div className="flex flex-col justify-center gap-1.5">
      <div className="flex gap-1">
        {imageUrl && (
          <Image width={24} height={24} src={imageUrl} alt="Group Logo" />
        )}
        <span className="text-lg font-semibold">{title}</span>
        {remoteEngine && (
          <SetUpComponent
            engine={remoteEngine}
            imageUrl={imageUrl}
            apiKeyUrl={apiKeyUrl}
          />
        )}
      </div>
      <span className="text-[hsla(var(--text-secondary)] text-sm">
        {description}
      </span>
    </div>
  )
}

type SetUpProps = {
  engine: RemoteEngine
  imageUrl?: string
  apiKeyUrl?: string
}

const SetUpComponent: React.FC<SetUpProps> = ({
  imageUrl,
  engine,
  apiKeyUrl,
}) => {
  const { data: engineData } = useEngineQuery()
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)

  const isHasApiKey = useMemo(
    () =>
      engineData == null
        ? false
        : engineData.find((e) => e.name === engine)?.status ===
          EngineStatus.Ready,
    [engineData, engine]
  )

  const onSetUpClick = useCallback(() => {
    setUpRemoteModelStage('SETUP_API_KEY', engine, {
      logo: imageUrl,
      api_key_url: apiKeyUrl,
    })
  }, [setUpRemoteModelStage, engine, imageUrl, apiKeyUrl])

  return (
    <div className="ml-auto">
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
    </div>
  )
}

export default GroupInfo
