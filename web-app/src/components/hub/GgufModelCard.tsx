import { cn, toGigabytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  IconFile,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react'

export interface LocalGgufModel {
  id: string
  name: string
  size: number
  path: string
  family?: string
  params?: number
  quantization?: string
}

interface GgufModelCardProps {
  model: LocalGgufModel
  onLoad: (model: LocalGgufModel) => void
  onDelete: (model: LocalGgufModel) => void
}

export function GgufModelCard({ model, onLoad, onDelete }: GgufModelCardProps) {
  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border border-border bg-card shadow-sm',
        'hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 p-4 gap-3'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate">
            {model.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
              {model.family || 'Other'}
            </span>
            {model.params && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary font-mono font-medium">
                {model.params}B
              </span>
            )}
            {model.quantization && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                {model.quantization}
              </span>
            )}
          </div>
        </div>
        <IconFile size={18} className="text-muted-foreground shrink-0" />
      </div>

      <div className="text-xs text-muted-foreground font-mono">
        {toGigabytes(model.size)}
      </div>

      <div className="flex items-center gap-2 mt-auto pt-1">
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs flex-1"
          onClick={() => onLoad(model)}
        >
          <IconPlayerPlay size={14} className="mr-1" />
          加载到引擎
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(model)}
        >
          <IconTrash size={14} />
        </Button>
      </div>
    </div>
  )
}
