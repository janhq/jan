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
  return (
    <div className="mb-6 flex flex-col overflow-hidden border-b border-[hsla(var(--app-border))]">
      <ModelItemHeader model={model} />

      <div className="flex">
        <div className="flex w-full flex-col py-4 ">
          <div className="my-2 inline-flex items-center sm:hidden">
            <span className="mr-4">{toGibibytes(model.metadata?.size)}</span>
            <ModelLabel metadata={model.metadata} />
          </div>
          <div className="flex flex-col">
            <p className="text-[hsla(var(--text-secondary))]">
              {model.description || '-'}
            </p>
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
    </div>
  )
}

export default ModelItem
