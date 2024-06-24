import React, { useEffect, useState } from 'react'

import useHuggingFace, { HuggingFaceModelEntry } from '@/hooks/useHuggingFace'

import Filter from './components/Filter'
import HubModelCard from './components/HubModelCard'
import ModelSearchBar from './components/ModelSearchBar'
import Slider from './components/Slider'

const HubScreen2: React.FC = () => {
  const [modelEntries, setModelEntries] = useState<HuggingFaceModelEntry[]>([])
  const { listCortexHubModels } = useHuggingFace()

  useEffect(() => {
    listCortexHubModels().then((res) => {
      setModelEntries(res)
    })
  }, [listCortexHubModels])

  return (
    <div className="h-full w-full overflow-hidden px-1.5">
      <div className="h-full w-full gap-12 overflow-x-hidden rounded-md border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] text-[hsla(var(--text-primary))]">
        <ModelSearchBar />
        <Slider models={modelEntries} />
        <div className="mx-4 px-12">
          <Filter />
          {modelEntries.map((entry) => (
            <HubModelCard key={entry.name} {...entry} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default HubScreen2
