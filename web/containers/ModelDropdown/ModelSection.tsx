import { useEffect, useState } from 'react'

import Image from 'next/image'

import { LlmEngine, Model } from '@janhq/core'

import useGetModelsByEngine from '@/hooks/useGetModelsByEngine'

import { getTitleByCategory } from '@/utils/model-engine'

import ModelLabel from '../ModelLabel'

type Props = {
  engine: LlmEngine
  searchText: string
  onModelSelected: (model: Model) => void
}

const ModelSection: React.FC<Props> = ({
  engine,
  searchText,
  onModelSelected,
}) => {
  const [models, setModels] = useState<Model[]>([])
  const { getModelsByEngine } = useGetModelsByEngine()

  useEffect(() => {
    const matchedModels = getModelsByEngine(engine, searchText)
    setModels(matchedModels)
  }, [getModelsByEngine, engine, searchText])

  if (models.length === 0) return null
  const engineName = getTitleByCategory(engine)

  return (
    <div className="w-full pt-2">
      <h6 className="mb-1 px-3 font-medium text-[hsla(var(--text-secondary))]">
        {engineName}
      </h6>
      <ul className="pb-2">
        {models.map((model) => (
          <li
            key={model.id}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
            onClick={() => onModelSelected(model)}
          >
            {model.metadata?.logo && (
              <Image
                className="rounded-full object-cover"
                width={20}
                height={20}
                src={model.metadata?.logo}
                alt="logo"
              />
            )}
            <p className="line-clamp-1">{model.name ?? model.id}</p>
            <ModelLabel metadata={model.metadata} compact />
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ModelSection
