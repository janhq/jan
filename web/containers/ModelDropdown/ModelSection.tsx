import { useCallback, useEffect, useState } from 'react'

import Image from 'next/image'

import { LlmEngine, Model, RemoteEngine } from '@janhq/core'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { SettingsIcon } from 'lucide-react'

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
      <h6 className="mb-1 px-3 font-medium text-[hsla(var(--text-secondary))]">
        {engineName}
      </h6>
      <ul className="pb-2">
        {models.map((model) => (
          <li
            key={model.model}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
            onClick={() => onModelSelected(model)}
          >
            {model.metadata?.logo ? (
              <Image
                className="rounded-full object-cover"
                width={20}
                height={20}
                src={model.metadata?.logo}
                alt="logo"
              />
            ) : (
              !model.engine?.includes('cortex.') && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[hsla(var(--app-border))] bg-gradient-to-r from-cyan-500 to-blue-500" />
              )
            )}
            <div className="flex w-full items-center justify-between">
              <p className="line-clamp-1">{model.name ?? model.model}</p>
              {!model.engine?.includes('cortex.') && (
                <Button theme="icon" onClick={onSettingClick}>
                  <SettingsIcon
                    size={14}
                    className="text-[hsla(var(--text-secondary))]"
                  />
                </Button>
              )}
            </div>
            <ModelLabel metadata={model.metadata} compact />
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ModelSection
