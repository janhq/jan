import * as React from 'react'
import { cn, toGigabytes } from '@/lib/utils'
import { IconDownload, IconHeart } from '@tabler/icons-react'
import type { ModelScopeModel } from '@/services/modelscope/types'

export interface ModelCardProps {
  model: ModelScopeModel
  onClick?: (modelId: string) => void
  onTagClick?: (
    type: 'task' | 'library' | 'license' | 'params',
    value: string
  ) => void
}

function getFamilyInfo(
  model: ModelScopeModel
): { name: string; colorClass: string } | null {
  const name = (model.display_name || model.id).toLowerCase()
  if (name.includes('qwen'))
    return {
      name: 'Qwen',
      colorClass:
        'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    }
  if (name.includes('llama'))
    return {
      name: 'Llama',
      colorClass:
        'bg-blue-500/10 text-blue-600 border-blue-500/20',
    }
  if (name.includes('gemma'))
    return {
      name: 'Gemma',
      colorClass:
        'bg-purple-500/10 text-purple-600 border-purple-500/20',
    }
  if (name.includes('mistral'))
    return {
      name: 'Mistral',
      colorClass:
        'bg-orange-500/10 text-orange-600 border-orange-500/20',
    }
  if (name.includes('deepseek'))
    return {
      name: 'DeepSeek',
      colorClass:
        'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    }
  if (name.includes('phi'))
    return {
      name: 'Phi',
      colorClass:
        'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
    }
  return null
}

function detectFramework(model: ModelScopeModel): string | null {
  const tags = model.tags || []
  const id = model.id.toLowerCase()
  if (
    tags.some((t) => t.toLowerCase().includes('gguf')) ||
    id.includes('gguf')
  )
    return 'GGUF'
  if (
    tags.some((t) => t.toLowerCase().includes('pytorch')) ||
    id.includes('pytorch')
  )
    return 'PyTorch'
  if (
    tags.some((t) => t.toLowerCase().includes('safetensors')) ||
    id.includes('safetensors')
  )
    return 'Safetensors'
  if (tags.some((t) => t.toLowerCase().includes('transformers')))
    return 'Transformers'
  return null
}

function formatParams(params: number): string {
  if (params >= 1000) return `${(params / 1000).toFixed(1)}T`
  if (params >= 1) return `${params}B`
  if (params > 0) return `${(params * 1000).toFixed(0)}M`
  return ''
}

export const ModelCard = React.memo(function ModelCard(props: ModelCardProps) {
  const { model, onClick } = props
  const displayName =
    model.display_name || model.id.split('/').pop() || model.id
  const namespace = model.id.split('/')[0]
  const family = getFamilyInfo(model)
  const framework = detectFramework(model)
  const paramsText = formatParams(model.params)

  const handleClick = React.useCallback(() => {
    onClick?.(model.id)
  }, [onClick, model.id])

  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border border-border bg-card shadow-sm overflow-hidden',
        'hover:-translate-y-0.5 hover:shadow-md hover:border-border/80',
        'transition-all duration-200 ease-out cursor-pointer'
      )}
      onClick={handleClick}
    >
      {/* Top meta bar */}
      <div className="flex items-center gap-1.5 flex-wrap px-4 pt-3 pb-2">
        {family && (
          <span
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-md border font-semibold',
              family.colorClass
            )}
          >
            {family.name}
          </span>
        )}
        {paramsText && (
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-bold border border-primary/20">
            {paramsText}
          </span>
        )}
        {framework && (
          <span className="text-[11px] px-2 py-0.5 rounded-md border border-border text-muted-foreground">
            {framework}
          </span>
        )}
        {model.tasks?.slice(0, 1).map((task) => (
          <span
            key={task}
            className="text-[11px] px-2 py-0.5 rounded-md bg-secondary text-muted-foreground"
          >
            {task}
          </span>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 px-4 pb-3 flex flex-col gap-1">
        {/* Title */}
        <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">
          {displayName}
        </h3>

        {/* Description */}
        {model.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {model.description}
          </p>
        )}
      </div>

      {/* Bottom stats */}
      <div className="px-4 py-2 border-t border-border/30 flex items-center justify-between bg-muted/20">
        <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
          By {namespace}
        </span>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <IconHeart size={13} />
            {model.likes.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <IconDownload size={13} />
            {model.downloads.toLocaleString()}
          </span>
          <span className="font-mono">{toGigabytes(model.file_size)}</span>
        </div>
      </div>
    </div>
  )
})
