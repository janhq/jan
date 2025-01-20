import { ModelSource } from '@janhq/core'

import ModelLabel from '@/containers/ModelLabel'

import ModelItemHeader from '@/screens/Hub/ModelList/ModelHeader'

import { toGigabytes } from '@/utils/converter'
import { extractDescription } from '@/utils/modelSource'
import MarkdownText from '@/containers/Markdown'

type Props = {
  model: ModelSource
  onSelectedModel: () => void
}

const ModelItem: React.FC<Props> = ({ model, onSelectedModel }) => {
  return (
    <div className="mb-6 flex flex-col overflow-hidden border-b border-[hsla(var(--app-border))]">
      <ModelItemHeader model={model} onSelectedModel={onSelectedModel} />

      <div className="flex">
        <div className="flex w-full flex-col py-4 ">
          <div className="my-2 inline-flex items-center sm:hidden">
            <span className="mr-4">{toGigabytes(model.models?.[0]?.size)}</span>
            <ModelLabel metadata={model.metadata} />
          </div>
          <div className="flex flex-col">
            <MarkdownText
              text={extractDescription(model.metadata?.description) || '-'}
              className="font-light text-[hsla(var(--text-secondary))]"
            />
          </div>
          <div className="flex flex-col gap-y-4 sm:flex-row sm:gap-x-10 sm:gap-y-0">
            <p
              className="font-regular mt-3 line-clamp-1 text-[hsla(var(--text-secondary))]"
              title={model.metadata?.author}
            >
              {model.metadata?.author}
            </p>
          </div>
        </div>

        <div className="hidden w-48 flex-shrink-0 border-l border-t border-[hsla(var(--app-border))] p-4">
          <div>
            <span className="font-semibold ">Format</span>
            <p className="mt-2 font-medium uppercase">GGUF</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModelItem
