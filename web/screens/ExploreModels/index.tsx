import { useState } from 'react'

import { Input, ScrollArea } from '@janhq/uikit'

import { SearchIcon } from 'lucide-react'

import { Code2Icon, UserIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import Loader from '@/containers/Loader'

import { useGetConfiguredModels } from '@/hooks/useGetConfiguredModels'

import ExploreModelList from './ExploreModelList'

const ExploreModelsScreen = () => {
  const { loading, models } = useGetConfiguredModels()
  const [searchValue, setsearchValue] = useState('')
  const [tabActive, setTabActive] = useState('Model')
  if (loading) return <Loader description="loading ..." />

  return (
    <div className="flex h-full w-full overflow-y-auto bg-background">
      <div className="h-full w-full p-4">
        <div className="h-full" data-test-id="testid-explore-models">
          <ScrollArea>
            <div className="relative">
              <img src="./images/hub-banner.png" alt="Hub Banner" />
              <div className="absolute left-1/2 top-1/2 w-1/3 -translate-x-1/2 -translate-y-1/2">
                <SearchIcon
                  size={20}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  placeholder="Search models"
                  className="bg-white pl-9 dark:bg-background"
                  onChange={(e) => {
                    setsearchValue(e.target.value)
                  }}
                />
              </div>
            </div>
            <div className="mx-auto w-4/5 py-6">
              <div className="flex items-center justify-between">
                <div className="inline-flex overflow-hidden rounded-lg border border-border">
                  <div
                    className={twMerge(
                      'flex cursor-pointer items-center space-x-2 border-r border-border px-3 py-2',
                      tabActive === 'Model' && 'bg-secondary'
                    )}
                    onClick={() => setTabActive('Model')}
                  >
                    <Code2Icon size={20} className="text-muted-foreground" />
                    <span>Model</span>
                  </div>
                  <div
                    className={twMerge(
                      'pointer-events-none flex cursor-pointer items-center space-x-2 px-3 py-2',
                      tabActive === 'Assistant' && 'bg-secondary'
                    )}
                    onClick={() => setTabActive('Assistant')}
                  >
                    <UserIcon size={20} className="text-muted-foreground" />
                    <span>Assistant</span>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <ExploreModelList models={models} />
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}

export default ExploreModelsScreen
