import { useCallback, useEffect, useState } from 'react'

import Image from 'next/image'

import { EngineStatus, LlmEngine, Model, RemoteEngine } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { SettingsIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import useEngineQuery from '@/hooks/useEngineQuery'
import useGetModelsByEngine from '@/hooks/useGetModelsByEngine'

import { getTitleByCategory } from '@/utils/model-engine'

import ModelLabel from '../ModelLabel'

import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

type Props = {
  engine: LlmEngine
  searchText: string
  onModelSelected: (model: Model) => void
}

const ModelSection: React.FC<Props> = ({
  engine,
  searchText,
  onModelSelected,
}) => {
  const [models, setModels] = useState<Model[]>([])
  const { getModelsByEngine } = useGetModelsByEngine()
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)
  const { data: engineData } = useEngineQuery()

  const engineLogo: string | undefined = models.find(
    (entry) => entry?.metadata?.logo != null
  )?.metadata?.logo

  const apiKeyUrl: string | undefined = models.find(
    (entry) => entry?.metadata?.api_key_url != null
  )?.metadata?.api_key_url

  const onSettingClick = useCallback(() => {
    setUpRemoteModelStage('SETUP_API_KEY', engine as unknown as RemoteEngine, {
      logo: engineLogo,
      api_key_url: apiKeyUrl,
    })
  }, [apiKeyUrl, engine, engineLogo, setUpRemoteModelStage])

  useEffect(() => {
    const matchedModels = getModelsByEngine(engine, searchText)
    setModels(matchedModels)
  }, [getModelsByEngine, engine, searchText])

  if (models.length === 0) return null
  const engineName = getTitleByCategory(engine)

  return (
    <div className="w-full pt-2">
      <div className="flex justify-between pr-2">
        <div className="flex gap-2 pl-3">
          {engineLogo && (
            <Image
              className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
              width={40}
              height={40}
              src={engineLogo}
              alt="logo"
            />
          )}
          <h6 className="mb-1 pr-3 font-medium text-[hsla(var(--text-secondary))]">
            {engineName}
          </h6>
        </div>
        <Button theme="icon" onClick={onSettingClick}>
          <SettingsIcon
            size={14}
            className="text-[hsla(var(--text-secondary))]"
          />
        </Button>
      </div>
      <ul className="pb-2">
        {models.map((model) => {
          const isEngineReady =
            engineData?.find((e) => e.name === model.engine)?.status ===
            EngineStatus.Ready
          return (
            <li
              key={model.model}
              className={twMerge(
                'flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]',
                isEngineReady
                  ? 'text-[hsla(var(--text-primary))]'
                  : 'cursor-not-allowed text-[hsla(var(--text-tertiary))]'
              )}
              onClick={() => {
                if (isEngineReady) {
                  onModelSelected(model)
                }
              }}
            >
              <div className="flex w-full items-center justify-between">
                <p className="line-clamp-1">{model.name ?? model.model}</p>
              </div>
              <ModelLabel metadata={model.metadata} compact />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default ModelSection
