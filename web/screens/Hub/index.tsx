import { useCallback, useMemo, useRef, useState, useEffect } from 'react'

import Image from 'next/image'

import { ModelSource } from '@janhq/core'

import { ScrollArea, Button, Select } from '@janhq/joi'
import { motion as m } from 'framer-motion'

import { useAtomValue, useSetAtom } from 'jotai'
import { UploadIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import CenterPanelContainer from '@/containers/CenterPanelContainer'
import ModelSearch from '@/containers/ModelSearch'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import { useGetModelSources } from '@/hooks/useModelSource'

import ModelList from '@/screens/Hub/ModelList'

import { extractModelRepo } from '@/utils/modelSource'
import { fuzzySearch } from '@/utils/search'

import ModelPage from './ModelPage'

import { modelDetailAtom } from '@/helpers/atoms/Model.atom'

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
  const { sources } = useGetModelSources()
  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [filterOption, setFilterOption] = useState('all')
  const [selectedModel, setSelectedModel] = useState<ModelSource | undefined>(
    undefined
  )
  const setImportModelStage = useSetAtom(setImportModelStageAtom)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelDetail = useAtomValue(modelDetailAtom)

  const filteredModels = useMemo(
    () =>
      searchValue.length
        ? (sources?.filter((e) =>
            fuzzySearch(
              searchValue.replaceAll(' ', '').toLowerCase(),
              e.id.toLowerCase()
            )
          ) ?? [])
        : [],
    [sources, searchValue]
  )

  useEffect(() => {
    if (modelDetail)
      setSelectedModel(sources?.find((e) => e.id === modelDetail))
  }, [modelDetail, sources])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setSearchValue('')
      }
    }

    // Attach the event listener
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      // Clean up the event listener
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const onImportModelClick = useCallback(() => {
    setImportModelStage('SELECTING_MODEL')
  }, [setImportModelStage])

  const onSearchUpdate = useCallback((input: string) => {
    setSearchValue(input)
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
                <div className="absolute left-1/2 top-1/2 z-10 mx-auto w-4/5 -translate-x-1/2 -translate-y-1/2 rounded-xl sm:w-2/6">
                  <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
                    <div className="w-full" ref={dropdownRef}>
                      <ModelSearch onSearchLocal={onSearchUpdate} />
                      <div
                        className={twMerge(
                          'invisible absolute mt-2 w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-lg',
                          filteredModels.length > 0 && 'visible'
                        )}
                      >
                        {filteredModels.map((model) => (
                          <div
                            key={model.id}
                            className="z-10 flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                            onClick={(e) => {
                              setSelectedModel(model)
                              e.stopPropagation()
                            }}
                          >
                            <span className="text-bold flex flex-row text-[hsla(var(--app-text-primary))]">
                              {searchValue.includes('huggingface.co') && (
                                <>
                                  <Image
                                    src={'icons/huggingFace.svg'}
                                    width={16}
                                    height={16}
                                    className="mr-2"
                                    alt=""
                                  />{' '}
                                </>
                              )}
                              {extractModelRepo(model.id)}
                            </span>
                          </div>
                        ))}
                      </div>
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
                    onSelectedModel={(model) => setSelectedModel(model)}
                  />
                </>
              </div>
            </>
          </ScrollArea>
        )}
        {selectedModel && (
          <ModelPage
            model={selectedModel}
            onGoBack={() => {
              setSearchValue('')
              setSelectedModel(undefined)
            }}
          />
        )}
      </m.div>
    </CenterPanelContainer>
  )
}

export default HubScreen
