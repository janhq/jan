import { LlmEngine, Model } from '@janhq/core'
import { useAtomValue } from 'jotai'

import ModelLabel from '../ModelLabel'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

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
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const modelByEngine = downloadedModels
    .filter((x) => x.engine === engine)
    .filter((x) => {
      if (searchText.trim() === '') return true
      return x.id.includes(searchText)
    })

  if (modelByEngine.length === 0) return null

  return (
    <div className="w-full pt-2">
      <h6 className="mb-1 px-3 font-medium text-[hsla(var(--text-secondary))]">
        {engine}
      </h6>
      <ul className="pb-2">
        {modelByEngine.map((model) => (
          <li
            key={model.id}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
            onClick={() => onModelSelected(model)}
          >
            {model.metadata?.owner_logo && (
              <img
                className="h-5 w-5 rounded-full object-cover"
                src={model.metadata?.owner_logo}
                alt="bot"
              />
            )}
            <p className="line-clamp-1">{model.id}</p>
            <ModelLabel metadata={model.metadata} compact />
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ModelSection
