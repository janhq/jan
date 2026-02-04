import { cn } from '@/lib/utils'
import { PromptTemplate } from '@janhq/core'
import { IconSparkles } from '@tabler/icons-react'

interface PromptAutocompleteProps {
  suggestions: PromptTemplate[]
  selectedIndex: number
  onSelect: (template: PromptTemplate) => void
  inputRect?: DOMRect | null
  showAbove?: boolean
}

export function PromptAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  inputRect,
  showAbove = true,
}: PromptAutocompleteProps) {
  if (suggestions.length === 0) return null

  const maxHeight = 300
  const itemHeight = 60

  // Calculate position - show above input by default
  const position = inputRect
    ? {
        left: inputRect.left,
        [showAbove ? 'bottom' : 'top']: showAbove
          ? window.innerHeight - inputRect.top + 8
          : inputRect.bottom + 8,
        width: Math.min(inputRect.width, 500),
      }
    : { left: 0, top: 0, width: 500 }

  return (
    <div
      className={cn(
        'fixed z-[100] shadow-xl rounded-lg',
        'bg-main-view border border-main-view-fg/10',
        'overflow-hidden'
      )}
      style={{
        ...position,
        maxHeight,
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-main-view-fg/10 bg-main-view-fg/5">
        <div className="flex items-center gap-2">
          <IconSparkles size={14} className="text-main-view-fg/50" />
          <span className="text-xs font-medium text-main-view-fg/70">
            Prompt Templates
          </span>
          <span className="text-xs text-main-view-fg/40 ml-auto">
            {suggestions.length} found
          </span>
        </div>
      </div>

      {/* Suggestions List */}
      <div className="overflow-y-auto" style={{ maxHeight: maxHeight - 50 }}>
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.id}
            onClick={() => onSelect(suggestion)}
            className={cn(
              'w-full text-left px-3 py-2.5 transition-colors',
              'hover:bg-main-view-fg/5',
              'border-b border-main-view-fg/5 last:border-b-0',
              selectedIndex === index && 'bg-main-view-fg/10'
            )}
            style={{ minHeight: itemHeight }}
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-main-view-fg">
                  /{suggestion.trigger}
                </span>
                {selectedIndex === index && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
                    Enter to use
                  </span>
                )}
              </div>
              <span className="text-xs text-main-view-fg/60 line-clamp-2">
                {suggestion.description || 'No description'}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-main-view-fg/10 bg-main-view-fg/5">
        <div className="flex items-center gap-3 text-[10px] text-main-view-fg/50">
          <span>
            <kbd className="px-1 py-0.5 rounded bg-main-view-fg/10 font-mono">
              ↑↓
            </kbd>{' '}
            Navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-main-view-fg/10 font-mono">
              Enter
            </kbd>{' '}
            Select
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-main-view-fg/10 font-mono">
              Esc
            </kbd>{' '}
            Close
          </span>
        </div>
      </div>
    </div>
  )
}
