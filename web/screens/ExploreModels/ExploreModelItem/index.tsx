import { useState } from 'react'

import { Model } from '@janhq/core'
import { Badge } from '@janhq/uikit'

import ExploreModelItemHeader from '@/screens/ExploreModels/ExploreModelItemHeader'

type Props = {
  model: Model
}

const ExploreModelItem: React.FC<Props> = ({ model }) => {
  const [open, setOpen] = useState('')

  const handleToggle = () => {
    if (open === model.id) {
      setOpen('')
    } else {
      setOpen(model.id)
    }
  }

  return (
    <div className="mb-6 flex flex-col overflow-hidden rounded-xl border border-border bg-background/60">
      <ExploreModelItemHeader
        model={model}
        onClick={handleToggle}
        open={open}
      />
      {open === model.id && (
        <div className="flex">
          <div className="flex w-full flex-col border-t border-border p-4 ">
            <div className="mb-6 flex flex-col gap-1">
              <span className="font-semibold">About</span>
              <p className="text-muted-foreground">
                {model.description || '-'}
              </p>
            </div>
            <div className="flex space-x-10">
              <div>
                <span className="font-semibold text-muted-foreground">
                  Author
                </span>
                <p className="mt-2 line-clamp-1 font-medium">
                  {model.metadata.author}
                </p>
              </div>
              <div>
                <span className="mb-1 font-semibold text-muted-foreground">
                  Model ID
                </span>
                <p className="mt-2 line-clamp-1 font-medium">{model.id}</p>
              </div>
              <div>
                <span className="mb-1 font-semibold text-muted-foreground">
                  Tags
                </span>
                <div className="mt-2 flex space-x-2">
                  {model.metadata.tags.map((tag, i) => (
                    <Badge
                      key={i}
                      themes="primary"
                      className="line-clamp-1"
                      title={tag}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="w-48 flex-shrink-0 border-l border-t border-border p-4">
            <div>
              <span className="font-semibold text-muted-foreground">
                Format
              </span>
              <p className="mt-2 font-medium uppercase">{model.format}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExploreModelItem
