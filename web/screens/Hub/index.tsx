import { useCallback, useState } from 'react'

import Image from 'next/image'

import { ModelSource } from '@janhq/core'

import { ScrollArea, Button, Select } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { UploadIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import BlankState from '@/containers/BlankState'
import CenterPanelContainer from '@/containers/CenterPanelContainer'
import ModelSearch from '@/containers/ModelSearch'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import ModelList from '@/screens/Hub/ModelList'

import ModelPage from './ModelPage'

import { motion as m } from 'framer-motion'

import {
  configuredModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const sortMenus = [
  {
    name: 'Most downloaded',
    value: 'most-downloaded',
  },
  {
    name: 'Newest',
    value: 'newest',
  },
]
const filterOptions = [
  {
    name: 'All',
    value: 'all',
  },
  {
    name: 'On-device',
    value: 'on-device',
  },
  {
    name: 'Cloud',
    value: 'cloud',
  },
]

const HubScreen = () => {
  const configuredModels = useAtomValue(configuredModelsAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const [searchValue, setsearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [filterOption, setFilterOption] = useState('all')
  const [selectedModel, setSelectedModel] = useState<ModelSource | undefined>(
    undefined
  )

  const setImportModelStage = useSetAtom(setImportModelStageAtom)

  const filteredModels = configuredModels.filter((x) => {
    if (sortSelected === 'downloaded') {
      return (
        x.name.toLowerCase().includes(searchValue.toLowerCase()) &&
        downloadedModels.some((y) => y.id === x.id)
      )
    } else if (sortSelected === 'featured') {
      return (
        x.name.toLowerCase().includes(searchValue.toLowerCase()) &&
        x.metadata?.tags?.includes('Featured')
      )
    } else {
      return x.name.toLowerCase().includes(searchValue.toLowerCase())
    }
  })

  const onImportModelClick = useCallback(() => {
    setImportModelStage('SELECTING_MODEL')
  }, [setImportModelStage])

  const onSearchUpdate = useCallback((input: string) => {
    setsearchValue(input)
  }, [])

  return (
    <CenterPanelContainer>
      <m.div
        key={selectedModel?.id}
        initial={{ opacity: 0, y: -8 }}
        className="h-full"
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.25,
          },
        }}
      >
        {!selectedModel && (
          <ScrollArea
            data-testid="hub-container-test-id"
            className="h-full w-full"
          >
            <>
              <div className="relative h-40 p-4 sm:h-auto">
                <Image
                  src="./images/banner.jpg"
                  alt="Hub Banner"
                  width={800}
                  height={800}
                  className="h-full w-full rounded-lg object-cover"
                />
                <div className="absolute left-1/2 top-1/2 mx-auto w-4/5 -translate-x-1/2 -translate-y-1/2 rounded-xl sm:w-2/6">
                  <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
                    <div className="w-full">
                      <ModelSearch onSearchLocal={onSearchUpdate} />
                    </div>
                  </div>
                </div>
                <div className="absolute right-8 top-8 flex-shrink-0 rounded-md bg-[hsla(var(--app-bg))]">
                  <Button
                    onClick={onImportModelClick}
                    variant="solid"
                    theme="ghost"
                  >
                    <UploadIcon size={16} className="mr-2" />
                    <span>Import</span>
                  </Button>
                </div>
              </div>
              <div className="mt-8 p-4 py-0 sm:px-16">
                {!filteredModels.length ? (
                  <BlankState title="No search results found" />
                ) : (
                  <>
                    <div className="flex flex-row">
                      <div className="flex w-full flex-col items-start justify-between gap-4 py-4 first:pt-0 sm:flex-row">
                        <div className="flex items-center gap-x-2">
                          {filterOptions.map((e) => (
                            <div
                              key={e.value}
                              className={twMerge(
                                'rounded-md border duration-200 hover:border-gray-200 hover:bg-gray-200',
                                e.value === filterOption
                                  ? 'border-gray-200 bg-gray-200'
                                  : 'border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]'
                              )}
                            >
                              <Button
                                theme={'ghost'}
                                variant={'soft'}
                                onClick={() => setFilterOption(e.value)}
                              >
                                {e.name}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mb-4 flex w-full justify-end">
                        <Select
                          value={sortSelected}
                          onValueChange={(value) => {
                            setSortSelected(value)
                          }}
                          options={sortMenus}
                        />
                      </div>
                    </div>
                    <ModelList
                      models={filteredModels}
                      onSelectedModel={(model) => setSelectedModel(model)}
                    />
                  </>
                )}
              </div>
            </>
          </ScrollArea>
        )}
        {selectedModel && (
          <ModelPage
            model={selectedModel}
            onGoBack={() => setSelectedModel(undefined)}
          />
        )}
      </m.div>
    </CenterPanelContainer>
  )
}

export default HubScreen
