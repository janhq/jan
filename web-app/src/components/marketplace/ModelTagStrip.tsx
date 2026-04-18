import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { getModelTags } from './tagConstants'
import type { ModelScopeModel } from '@/services/modelscope/types'

export interface ModelTagStripProps {
  model: ModelScopeModel
  onTagClick?: (
    type: 'task' | 'library' | 'license' | 'params',
    value: string
  ) => void
  className?: string
}

export const ModelTagStrip = React.memo(function ModelTagStrip({
  model,
  onTagClick,
  className,
}: ModelTagStripProps) {
  const tags = getModelTags(model)

  if (tags.length === 0) return null

  return (
    <div
      className={cn(
        'hidden md:flex w-8 shrink-0 flex-col items-start pl-1 py-3 gap-1.5 bg-muted/50 rounded-l-lg border-r border-border/50',
        className
      )}
    >
      {tags.map((tag) => {
        const Icon = tag.icon
        return (
          <Tooltip key={`${tag.type}-${tag.value}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(tag.type, tag.value)
                }}
                className={cn(
                  'group relative z-0 hover:z-10 h-6 w-6 hover:w-auto rounded-sm',
                  'flex items-center justify-center overflow-hidden whitespace-nowrap',
                  'px-0 hover:px-1.5 border transition-[width,opacity] duration-200 ease-out cursor-pointer',
                  tag.colorClass
                )}
              >
                {Icon ? (
                  <Icon size={14} className="shrink-0" />
                ) : (
                  <span className="shrink-0 text-[10px] font-bold">
                    {tag.abbr}
                  </span>
                )}
                <span className="ml-0 w-0 opacity-0 group-hover:ml-1 group-hover:w-auto group-hover:opacity-100 transition-all duration-200 text-[10px] font-medium whitespace-nowrap">
                  {tag.label}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {tag.tooltip}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})
