import React, { Fragment, useState } from 'react'

import { RemoteEngine, RemoteEngines } from '@janhq/core'

import { ScrollArea } from '@janhq/joi'
import { useAtom } from 'jotai'

import CenterPanelContainer from '@/containers/CenterPanelContainer'

import useModelHub, { ModelHubCategory } from '@/hooks/useModelHub'

import { HfModelEntry } from '@/utils/huggingface'

import BuiltInModelGroup from './components/BuiltInModelGroup'
import DetailModelGroup from './components/DetailModelGroup'
import Filter from './components/Filter'
import HubScreenFilter from './components/HubScreenFilter'
import HuggingFaceModelGroup from './components/HuggingFaceModelGroup'
import LoadingIndicator from './components/LoadingIndicator'
import ModelSearchBar from './components/ModelSearchBar'
import RemoteModelGroup from './components/RemoteModelGroup'
import SidebarFilter from './components/SidebarFilter'
import Slider from './components/Slider'

import { hubFilterAtom } from '@/helpers/atoms/Hub.atom'
import { showSidbarFilterAtom } from '@/helpers/atoms/Setting.atom'

export const ModelFilters = ['All', 'On-device', 'Cloud'] as const
export type ModelFilter = (typeof ModelFilters)[number]

const HubScreen2: React.FC = () => {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useAtom(hubFilterAtom)

  const [showSidebarFilter, setShowSidebarFilter] =
    useAtom(showSidbarFilterAtom)

  const [detailCategory, setDetailCategory] = useState<
    ModelHubCategory | undefined
  >(undefined)
  const { data, isLoading } = useModelHub()

  if (isLoading) return <LoadingIndicator />
  if (!data) return <div>Failed to fetch models</div>

  const engineModelMap = new Map<typeof RemoteEngines, HfModelEntry[]>()
  Object.entries(data.modelCategories).forEach(([key, value]) => {
    if (key !== 'HuggingFace' && key !== 'BuiltInModels') {
      engineModelMap.set(key as unknown as typeof RemoteEngines, value)
    }
  })

  if (detailCategory) {
    return (
      <DetailModelGroup
        category={detailCategory}
        onBackClicked={() => setDetailCategory(undefined)}
      />
    )
  }

  const shouldShowRemoteModel = filter === 'All' || filter === 'Cloud'
  const shouldShowLocalModel = filter === 'All' || filter === 'On-device'

  return (
    <CenterPanelContainer>
      <ScrollArea data-testid="hub-container-test-id" className="h-full w-full">
        {showSidebarFilter && <SidebarFilter />}
        <ModelSearchBar onSearchChanged={setQuery} />
        {query.length > 0 ? (
          <HubScreenFilter queryText={query} />
        ) : (
          <Fragment>
            <Slider />
            <div data-testid="hub-search-bar" className="mx-4 px-4 md:px-12">
              <Filter
                currentFilter={filter}
                callback={() => setShowSidebarFilter(!showSidebarFilter)}
                onFilterClicked={(newFilter) => setFilter(newFilter)}
              />

              {shouldShowLocalModel && (
                <Fragment>
                  <BuiltInModelGroup
                    onSeeAllClick={() => setDetailCategory('BuiltInModels')}
                  />
                  <HuggingFaceModelGroup
                    onSeeAllClick={() => setDetailCategory('HuggingFace')}
                  />
                </Fragment>
              )}

              {shouldShowRemoteModel &&
                Array.from(engineModelMap.entries()).map(([engine, models]) => (
                  <RemoteModelGroup
                    key={engine as unknown as string}
                    data={models}
                    engine={engine as unknown as RemoteEngine}
                    onSeeAllClick={() =>
                      setDetailCategory(engine as unknown as ModelHubCategory)
                    }
                  />
                ))}
            </div>
          </Fragment>
        )}
      </ScrollArea>
    </CenterPanelContainer>
  )
}

export default HubScreen2
