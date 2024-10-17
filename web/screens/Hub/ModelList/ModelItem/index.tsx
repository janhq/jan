import { useState } from 'react'

import { Model } from '@janhq/core'
import { Badge } from '@janhq/joi'

import { twMerge } from 'tailwind-merge'

import ModelLabel from '@/containers/ModelLabel'

import ModelItemHeader from '@/screens/Hub/ModelList/ModelHeader'

import { toGibibytes } from '@/utils/converter'

type Props = {
  model: Model
}

const ModelItem: React.FC<Props> = ({ model }) => {
  const [open, setOpen] = useState('')

  const handleToggle = () => {
    if (open === model.id) {
      setOpen('')
    } else {
      setOpen(model.id)
    }
  }

  return (
    <div className="mb-6 flex flex-col overflow-hidden rounded-xl border border-[hsla(var(--app-border))]">
      <ModelItemHeader model={model} onClick={handleToggle} open={open} />
      {open === model.id && (
        <div className="flex">
          <div className="flex w-full flex-col border-t border-[hsla(var(--app-border))] p-4 ">
            <div className="my-2 inline-flex items-center sm:hidden">
              <span className="mr-4 font-semibold">
                {toGibibytes(model.metadata?.size)}
              </span>
              <ModelLabel metadata={model.metadata} />
            </div>
            <div className="mb-6 flex flex-col gap-1">
              <span className="font-semibold">About</span>
              <p className="text-[hsla(var(--text-secondary))]">
                {model.description || '-'}
              </p>
            </div>
            <div className="flex flex-col gap-y-4 sm:flex-row sm:gap-x-10 sm:gap-y-0">
              <div>
                <span className="font-semibold ">Author</span>
                <p
                  className="mt-2 line-clamp-1 font-medium text-[hsla(var(--text-secondary))]"
                  title={model.metadata?.author}
                >
                  {model.metadata?.author}
                </p>
              </div>
              <div>
                <span className="mb-1 font-semibold ">Model ID</span>
                <p
                  className="mt-2 line-clamp-1 font-medium text-[hsla(var(--text-secondary))]"
                  title={model.id}
                >
                  {model.id}
                </p>
              </div>
              <div>
                <span className="mb-1 font-semibold ">Tags</span>
                <div className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
                  {model.metadata?.tags?.map((tag: string) => (
                    <Badge key={tag} title={tag} variant="soft">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="hidden w-48 flex-shrink-0 border-l border-t border-[hsla(var(--app-border))] p-4">
            <div>
              <span className="font-semibold ">Format</span>
              <p
                className={twMerge(
                  'mt-2 font-medium',
                  !model.format?.includes(' ') &&
                    !model.format?.includes('-') &&
                    'uppercase'
                )}
              >
                {model.format}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ModelItem
