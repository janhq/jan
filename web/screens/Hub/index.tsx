import { useCallback, useState } from 'react'

import Image from 'next/image'

import { ScrollArea, Button, Select } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { UploadIcon } from 'lucide-react'

import BlankState from '@/containers/BlankState'
import CenterPanelContainer from '@/containers/CenterPanelContainer'
import ModelSearch from '@/containers/ModelSearch'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import ModelList from '@/screens/Hub/ModelList'

import {
  configuredModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const sortMenus = [
  {
    name: 'All Models',
    value: 'all-models',
  },
  {
    name: 'Featured',
    value: 'featured',
  },
  {
    name: 'Downloaded',
    value: 'downloaded',
  },
]

const HubScreen = () => {
  const configuredModels = useAtomValue(configuredModelsAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const [searchValue, setsearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('all-models')

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
      <ScrollArea data-testid="hub-container-test-id" className="h-full w-full">
        <div className="relative h-40 p-4 sm:h-auto">
          <Image
            src="./images/hub-banner.png"
            alt="Hub Banner"
            width={800}
            height={800}
            className="h-full w-full rounded-lg object-cover"
          />
          <div className="absolute left-1/2 top-1/2 mx-auto w-4/5 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[hsla(var(--app-bg))] p-4 sm:w-1/2">
            <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
              <div className="w-full">
                <ModelSearch onSearchLocal={onSearchUpdate} />
              </div>
              <div className="flex-shrink-0">
                <Button onClick={onImportModelClick}>
                  <UploadIcon size={16} className="mr-2" />
                  <span>Import Model</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 py-0 sm:px-16">
          {!filteredModels.length ? (
            <BlankState title="No search results found" />
          ) : (
            <>
              <div className="mb-4 flex w-full justify-end">
                <Select
                  value={sortSelected}
                  onValueChange={(value) => {
                    setSortSelected(value)
                  }}
                  options={sortMenus}
                />
              </div>
              <ModelList models={filteredModels} />
            </>
          )}
        </div>
      </ScrollArea>
    </CenterPanelContainer>
  )
}

export default HubScreen
