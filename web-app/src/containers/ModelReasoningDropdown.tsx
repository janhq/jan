import { memo, useCallback } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  applyModelReasoningUpdate,
  getModelReasoningLabel,
  getModelReasoningOptions,
  getModelReasoningValue,
  modelSupportsReasoningControl,
  type ModelReasoningValue,
} from '@/lib/model-reasoning'
import { cn } from '@/lib/utils'

type ModelReasoningDropdownProps = {
  model: Model
  providerName: string
  variant?: 'row' | 'panel'
  className?: string
}

export const ModelReasoningDropdown = memo(function ModelReasoningDropdown({
  model,
  providerName,
  variant = 'row',
  className,
}: ModelReasoningDropdownProps) {
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const updateProvider = useModelProvider((state) => state.updateProvider)
  const selectModelProvider = useModelProvider(
    (state) => state.selectModelProvider
  )
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)

  const reasoningOptions = getModelReasoningOptions(model)
  const reasoningValue = getModelReasoningValue(model)
  const activeLabel = getModelReasoningLabel(model) ?? 'Reasoning'

  const setReasoning = useCallback(
    (value: ModelReasoningValue) => {
      const providerObj = getProviderByName(providerName)
      if (!providerObj) return

      const updatedProvider = applyModelReasoningUpdate(
        providerObj,
        model.id,
        value
      )
      if (!updatedProvider) return

      updateProvider(providerName, {
        models: updatedProvider.models,
      })

      if (selectedProvider === providerName && selectedModel?.id === model.id) {
        selectModelProvider(providerName, model.id)
      }
    },
    [
      getProviderByName,
      model.id,
      providerName,
      selectModelProvider,
      selectedModel?.id,
      selectedProvider,
      updateProvider,
    ]
  )

  if (!modelSupportsReasoningControl(model) || reasoningOptions.length === 0) {
    return null
  }

  const isRow = variant === 'row'

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background font-medium text-foreground transition-colors hover:bg-secondary/40',
                isRow
                  ? 'px-1.5 py-0.5 text-[11px] shadow-none'
                  : 'px-2.5 py-1.5 text-sm shadow-sm',
                className
              )}
              aria-label="Reasoning"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span>{activeLabel}</span>
              <ChevronsUpDown
                className={cn(
                  'text-muted-foreground',
                  isRow ? 'size-3' : 'size-4'
                )}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {reasoningOptions.find((option) => option.value === reasoningValue)
            ?.title ?? activeLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-32"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {reasoningOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={cn(
              'cursor-pointer',
              reasoningValue === option.value && 'bg-secondary/60'
            )}
            onClick={() => setReasoning(option.value)}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">
                {option.title}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})