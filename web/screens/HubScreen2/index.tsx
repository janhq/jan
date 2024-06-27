import React, { useEffect, useState } from 'react'

import useHuggingFace, { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import Filter from './components/Filter'
import HubModelCard from './components/HubModelCard'
import ModelSearchBar from './components/ModelSearchBar'
import SidebarFilter from './components/SidebarFilter'
import Slider from './components/Slider'

const HubScreen2: React.FC = () => {
  const [modelEntries, setModelEntries] = useState<HuggingFaceModelEntry[]>([])
  const { listCortexHubModels } = useHuggingFace()
  const [showFilter, setShowFilter] = useState(false)

  useEffect(() => {
    listCortexHubModels().then((res) => {
      setModelEntries(res)
    })
  }, [listCortexHubModels])

  return (
    <div className="flex h-full w-full overflow-hidden pr-1.5">
      {showFilter && <SidebarFilter />}
      <div className="relative h-full flex-1 flex-shrink-0 gap-12 overflow-x-hidden border-l border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] text-[hsla(var(--text-primary))]">
        <ModelSearchBar />
        <Slider models={modelEntries} />
        <div className="mx-4 px-12">
          <Filter callback={() => setShowFilter(!showFilter)} />
          {modelEntries.map((entry) => (
            <HubModelCard key={entry.name} {...entry} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default HubScreen2
