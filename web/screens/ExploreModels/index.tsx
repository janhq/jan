import { useCallback, useState } from 'react'

import {
  ScrollArea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  Button,
} from '@janhq/uikit'

import { useAtomValue, useSetAtom } from 'jotai'
import { UploadIcon } from 'lucide-react'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import ModelSearch from '../Settings/Models/ModelSearch'

import ExploreModelList from './ExploreModelList'

import {
  configuredModelsAtom,
  downloadedModelsAtom,
} from '@/helpers/atoms/Model.atom'

const sortMenu = ['All Models', 'Recommended', 'Downloaded']

const ExploreModelsScreen = () => {
  const configuredModels = useAtomValue(configuredModelsAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const [searchValue, setsearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('All Models')

  const setImportModelStage = useSetAtom(setImportModelStageAtom)

  const filteredModels = configuredModels.filter((x) => {
    if (sortSelected === 'Downloaded') {
      return (
        x.name.toLowerCase().includes(searchValue.toLowerCase()) &&
        downloadedModels.some((y) => y.id === x.id)
      )
    } else if (sortSelected === 'Recommended') {
      return (
        x.name.toLowerCase().includes(searchValue.toLowerCase()) &&
        x.metadata.tags.includes('Featured')
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
    <div
      className="flex h-full w-full overflow-y-auto bg-background"
      data-testid="hub-container-test-id"
    >
      <div className="h-full w-full p-4">
        <div className="h-full">
          <ScrollArea>
            <div className="relative">
              <img
                src="./images/hub-banner.png"
                alt="Hub Banner"
                className="w-full object-cover"
              />
              <div className="absolute left-1/2 top-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 space-y-2">
                <div className="flex flex-row space-x-2">
                  <ModelSearch onSearchLocal={onSearchUpdate} />
                  <Button
                    themes="outline"
                    className="gap-2 bg-white dark:bg-secondary"
                    onClick={onImportModelClick}
                  >
                    <UploadIcon size={16} />
                    Import Model
                  </Button>
                </div>
              </div>
            </div>
            <div className="mx-auto w-4/5 py-6">
              <div className="flex items-center justify-end">
                <Select
                  value={sortSelected}
                  onValueChange={(value) => {
                    setSortSelected(value)
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Sort By"></SelectValue>
                  </SelectTrigger>
                  <SelectContent className="right-0 block w-full min-w-[200px] pr-0">
                    <SelectGroup>
                      {sortMenu.map((x, i) => {
                        return (
                          <SelectItem key={i} value={x}>
                            <span className="line-clamp-1 block">{x}</span>
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-6">
                <ExploreModelList models={filteredModels} />
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}

export default ExploreModelsScreen
