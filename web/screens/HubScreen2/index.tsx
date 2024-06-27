import React, { useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import useHuggingFace from '@/hooks/useHuggingFace'

import Filter from './components/Filter'
import HubModelCard from './components/HubModelCard'
import ModelSearchBar from './components/ModelSearchBar'
import SidebarFilter from './components/SidebarFilter'
import Slider from './components/Slider'

const HubScreen2: React.FC = () => {
  const { listCortexHubModels } = useHuggingFace()
  const [showFilter, setShowFilter] = useState(false)

  const { isPending, error, data } = useQuery({
    queryKey: ['listCortexHub'],
    queryFn: () => listCortexHubModels(),
  })

  // TODO: NamH adding loading state for this screen
  if (!data) return null

  return (
    <div className="flex h-full w-full overflow-hidden pr-1.5">
      {showFilter && <SidebarFilter />}
      <div className="h-full flex-1 flex-shrink-0 gap-12 overflow-x-hidden border-l border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] text-[hsla(var(--text-primary))]">
        <ModelSearchBar />
        <Slider models={data} />
        <div className="mx-4 px-12">
          <Filter callback={() => setShowFilter(!showFilter)} />
          {data?.map((entry) => <HubModelCard key={entry.name} {...entry} />)}
        </div>
      </div>
    </div>
  )
}

export default HubScreen2
