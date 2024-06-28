import React, { useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import { useAtomValue, useSetAtom } from 'jotai'
import { twMerge } from 'tailwind-merge'

import useHuggingFace from '@/hooks/useHuggingFace'

import Filter from './components/Filter'
import HubModelCard from './components/HubModelCard'
import LoadingIndicator from './components/LoadingIndicator'
import ModelSearchBar from './components/ModelSearchBar'
import SidebarFilter from './components/SidebarFilter'
import Slider from './components/Slider'

import {
  reduceTransparentAtom,
  showSidbarFilterAtom,
} from '@/helpers/atoms/Setting.atom'

const HubScreen2: React.FC = () => {
  const { listCortexHubModels } = useHuggingFace()
  const showSidbarFilter = useAtomValue(showSidbarFilterAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const setShowSidebarFilter = useSetAtom(showSidbarFilterAtom)

  const { isPending, error, data } = useQuery({
    queryKey: ['listCortexHub'],
    queryFn: () => listCortexHubModels(),
  })
  if (isPending) return <LoadingIndicator />
  return (
    data && (
      <div
        className={twMerge(
          'flex h-full w-full overflow-hidden pr-1.5',
          !reduceTransparent && showSidbarFilter && 'border-l'
        )}
      >
        {showSidbarFilter && <SidebarFilter />}
        <div
          className={twMerge(
            'h-full flex-1 flex-shrink-0 gap-12 overflow-x-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] text-[hsla(var(--text-primary))]'
          )}
        >
          <ModelSearchBar />
          <Slider models={data} />
          <div className="mx-4 px-12">
            <Filter callback={() => setShowSidebarFilter(!showSidbarFilter)} />
            {data?.map((entry) => <HubModelCard key={entry.name} {...entry} />)}
          </div>
        </div>
      </div>
    )
  )
}

export default HubScreen2
