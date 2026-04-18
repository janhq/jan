import * as React from 'react'
import { cn, toGigabytes } from '@/lib/utils'
import { IconDownload, IconHeart } from '@tabler/icons-react'
import { ModelTagStrip } from './ModelTagStrip'
import { getModelTags } from './tagConstants'
import type { ModelScopeModel } from '@/services/modelscope/types'

export interface ModelCardProps {
  model: ModelScopeModel
  onClick?: (modelId: string) => void
  onTagClick?: (
    type: 'task' | 'library' | 'license' | 'params',
    value: string
  ) => void
}

export const ModelCard = React.memo(function ModelCard({
  model,
  onClick,
  onTagClick,
}: ModelCardProps) {
  const displayName =
    model.display_name || model.id.split('/').pop() || model.id
  const namespace = model.id.split('/')[0]
  const mobileTags = getModelTags(model)

  const handleClick = React.useCallback(() => {
    onClick?.(model.id)
  }, [onClick, model.id])

  return (
    <div
      className={cn(
        'group flex rounded-lg border border-border bg-card shadow-sm min-h-[140px] overflow-hidden',
        'cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-border/80',
        'transition-transform transition-shadow duration-200 ease-out'
      )}
      onClick={handleClick}
    >
      {/* Desktop left tag strip */}
      <ModelTagStrip model={model} onTagClick={onTagClick} />

      {/* Right content area */}
      <div className="flex-1 min-w-0 p-4 flex flex-col">
        {/* Mobile horizontal tag bar */}
        <div className="flex md:hidden flex-wrap gap-1.5 mb-2">
          {mobileTags.map((tag) => {
            const Icon = tag.icon
            return (
              <button
                key={`mobile-${tag.type}-${tag.value}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(tag.type, tag.value)
                }}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[10px] font-medium transition-colors max-w-full',
                  tag.colorClass
                )}
              >
                {Icon && <Icon size={12} className="shrink-0" />}
                <span className="truncate">{tag.label}</span>
              </button>
            )
          })}
        </div>

        {/* Title row + stats */}
        <div className="flex items-center justify-between gap-x-2 min-w-0">
          <h3
            className="text-foreground font-medium text-sm truncate min-w-0 overflow-hidden"
            title={displayName}
          >
            {displayName}
          </h3>
          <div className="shrink-0 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconDownload size={14} />
              {model.downloads.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <IconHeart size={14} />
              {model.likes.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Description */}
        {model.description && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-2 break-words">
            {model.description}
          </p>
        )}

        {/* Bottom meta row */}
        <div className="flex items-center flex-wrap gap-2 mt-auto pt-3 min-w-0">
          <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
            By {namespace}
          </span>
          {model.tasks?.slice(0, 2).map((task) => (
            <span
              key={task}
              className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[100px]"
            >
              {task}
            </span>
          ))}
          {model.license && (
            <span className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted-foreground truncate max-w-[120px]">
              {model.license}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground font-mono font-medium shrink-0">
            {toGigabytes(model.file_size)}
          </span>
        </div>
      </div>
    </div>
  )
})
