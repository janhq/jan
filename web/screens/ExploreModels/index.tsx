import { useCallback, useContext, useState } from 'react'

import {
  Input,
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
import { UploadIcon, SearchIcon } from 'lucide-react'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { setImportModelStageAtom } from '@/hooks/useImportModel'

import ExploreModelList from './ExploreModelList'
import { HuggingFaceModal } from './HuggingFaceModal'

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

  const [showHuggingFaceModal, setShowHuggingFaceModal] = useState(false)
  const setImportModelStage = useSetAtom(setImportModelStageAtom)

  const { experimentalFeature } = useContext(FeatureToggleContext)

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

  const onHuggingFaceConverterClick = () => {
    setShowHuggingFaceModal(true)
  }

  return (
    <div
      className="flex h-full w-full overflow-y-auto bg-background"
      data-testid="hub-container-test-id"
    >
      <div className="h-full w-full p-4">
        <div className="h-full">
          <HuggingFaceModal
            open={showHuggingFaceModal}
            onOpenChange={setShowHuggingFaceModal}
          />
          <ScrollArea>
            <div className="relative">
              <img
                src="./images/hub-banner.png"
                alt="Hub Banner"
                className="w-full object-cover"
              />
              <div className="absolute left-1/2 top-1/2 w-1/3 -translate-x-1/2 -translate-y-1/2 space-y-2">
                <div className="flex flex-row space-x-2">
                  <div className="relative">
                    <SearchIcon
                      size={20}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      placeholder="Search models"
                      className="bg-white pl-9"
                      onChange={(e) => setsearchValue(e.target.value)}
                    />
                  </div>
                  <Button
                    themes="outline"
                    className="gap-2 bg-white"
                    onClick={onImportModelClick}
                  >
                    <UploadIcon size={16} />
                    Import Model
                  </Button>
                </div>
                {experimentalFeature && (
                  <div className="text-center">
                    <p
                      onClick={onHuggingFaceConverterClick}
                      className="cursor-pointer font-semibold text-white underline"
                    >
                      Convert from Hugging Face
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="mx-auto w-4/5 py-6">
              <div className="flex items-center justify-end">
                {/* Temporary hide tabs */}
                {/* <div className="inline-flex overflow-hidden rounded-lg border border-border">
                  <div
                    className={twMerge(
                      'flex cursor-pointer items-center space-x-2 border-r border-border px-3 py-2',
                      tabActive === 'Model' && 'bg-secondary'
                    )}
                    onClick={() => setTabActive('Model')}
                  >
                    <Code2Icon size={20} className="text-muted-foreground" />
                    <span className="font-semibold">Model</span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger>
                      <div
                        className={twMerge(
                          'pointer-events-none flex cursor-pointer items-center space-x-2 px-3 py-2 text-muted-foreground',
                          tabActive === 'Assistant' && 'bg-secondary'
                        )}
                        onClick={() => setTabActive('Assistant')}
                      >
                        <UserIcon size={20} className="text-muted-foreground" />
                        <span className="font-semibold">Assistant</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={10}>
                      <span className="font-bold">Coming Soon</span>
                      <TooltipArrow />
                    </TooltipContent>
                  </Tooltip>
                </div> */}

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
