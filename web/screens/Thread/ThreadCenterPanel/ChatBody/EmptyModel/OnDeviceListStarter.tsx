import React, { Fragment, useCallback, useState } from 'react'

import Image from 'next/image'

import { Model, RemoteEngine, RemoteEngines } from '@janhq/core'
import { Input } from '@janhq/joi'

import { useSetAtom } from 'jotai'
import { SearchIcon, PlusIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import Spinner from '@/containers/Loader/Spinner'

import useModelHub from '@/hooks/useModelHub'

import BuiltInModelCard from '@/screens/HubScreen2/components/BuiltInModelCard'

import { HfModelEntry } from '@/utils/huggingface'

import { getTitleByCategory } from '@/utils/model-engine'

import { MainViewState, mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'
import { hubFilterAtom } from '@/helpers/atoms/Hub.atom'
import { setUpRemoteModelStageAtom } from '@/helpers/atoms/SetupRemoteModel.atom'

const OnDeviceStarterScreen = () => {
  const { data } = useModelHub()
  const [searchValue, setSearchValue] = useState('')
  const setLocalModelModalStage = useSetAtom(localModelModalStageAtom)
  const setUpRemoteModelStage = useSetAtom(setUpRemoteModelStageAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const setFilter = useSetAtom(hubFilterAtom)

  const onItemClick = useCallback(
    (name: string) => {
      setLocalModelModalStage('MODEL_LIST', name)
    },
    [setLocalModelModalStage]
  )

  if (!data)
    return (
      <div className="flex justify-center">
        <Spinner />
      </div>
    )

  const builtInModels: HfModelEntry[] =
    data.modelCategories.get('BuiltInModels') || []
  const huggingFaceModels: HfModelEntry[] =
    data.modelCategories.get('HuggingFace') || []

  const engineModelMap = new Map<typeof RemoteEngines, HfModelEntry[]>()
  Object.entries(data.modelCategories).forEach(([key, value]) => {
    if (key !== 'HuggingFace' && key !== 'BuiltInModels') {
      engineModelMap.set(key as unknown as typeof RemoteEngines, value)
    }
  })

  const models: HfModelEntry[] = builtInModels.concat(huggingFaceModels)

  const filteredModels = models.filter((model) => {
    return model.name.toLowerCase().includes(searchValue.toLowerCase())
  })

  const recommendModels = models.filter((model) => {
    return (
      model.name.toLowerCase().includes('cortexso/tinyllama') ||
      model.name.toLowerCase().includes('cortexso/mistral')
    )
  })

  return (
    <Fragment>
      <div className="relative">
        <Input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search..."
          prefixIcon={<SearchIcon size={16} />}
        />
        <div
          className={twMerge(
            'absolute left-0 top-10 max-h-[240px] w-full overflow-x-auto rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]',
            !searchValue.length ? 'invisible' : 'visible'
          )}
        >
          {!filteredModels.length ? (
            <div className="p-3 text-center">
              <p className="line-clamp-1 text-[hsla(var(--text-secondary))]">
                No Result Found
              </p>
            </div>
          ) : (
            filteredModels.map((model) => (
              <div
                className="cursor-pointer p-2 text-left transition-all hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                key={model.id}
                onClick={() => onItemClick(model.name)}
              >
                <p className="line-clamp-1">
                  {model.name.replaceAll('cortexso/', '')}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-[hsla(var(--text-secondary))]">On-device Models</h2>
        <p
          className="cursor-pointer text-sm text-[hsla(var(--app-link))]"
          onClick={() => {
            setFilter('On-device')
            setMainViewState(MainViewState.Hub)
          }}
        >
          See All
        </p>
      </div>
      {recommendModels.map((model) => (
        <BuiltInModelCard key={model.name} {...model} />
      ))}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-[hsla(var(--text-secondary))]">Cloud Models</h2>
      </div>

      <div className="flex items-center gap-6">
        {Array.from(engineModelMap.entries())
          .slice(0, 3)
          .map(([engine, models]) => {
            const engineLogo: string | undefined = models.find(
              (entry) => entry.model?.metadata?.logo != null
            )?.model?.metadata?.logo
            const apiKeyUrl: string | undefined = models.find(
              (entry) => entry.model?.metadata?.api_key_url != null
            )?.model?.metadata?.api_key_url
            const defaultModel: Model | undefined = models.find(
              (entry) => entry.model != null
            )?.model
            return (
              <div
                className="flex cursor-pointer flex-col items-center justify-center gap-2"
                key={engine as unknown as string}
                onClick={() => {
                  setUpRemoteModelStage(
                    'SETUP_API_KEY',
                    engine as unknown as RemoteEngine,
                    {
                      logo: engineLogo,
                      api_key_url: apiKeyUrl,
                      model: defaultModel,
                    }
                  )
                }}
              >
                {engineLogo ? (
                  <Image
                    width={48}
                    height={48}
                    src={engineLogo}
                    alt="Engine logo"
                    className="rounded-full"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[hsla(var(--app-border))] bg-gradient-to-r from-cyan-500 to-blue-500"></div>
                )}
                <p>{getTitleByCategory(engine as unknown as RemoteEngine)}</p>
              </div>
            )
          })}

        <div className="flex flex-col items-center justify-center gap-2">
          <div
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-dashed border-[hsla(var(--app-border))]"
            onClick={() => {
              setFilter('Cloud')
              setMainViewState(MainViewState.Hub)
            }}
          >
            <PlusIcon className="text-[hsla(var(--text-secondary))]" />
          </div>
          <p>See All</p>
        </div>
      </div>
    </Fragment>
  )
}

export default OnDeviceStarterScreen
