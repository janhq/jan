import { PromptTemplate } from '@janhq/core'
import { IconSparkles, IconBolt, IconArrowsDiagonal } from '@tabler/icons-react'

interface PromptSuggestionsProps {
  suggestions: PromptTemplate[]
  selectedIndex: number
  onSelect: (template: PromptTemplate) => void
  position: { top: number; left: number }
}

export function PromptSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  position,
}: PromptSuggestionsProps) {
  if (suggestions.length === 0) return null

  return (
    <div
      className="absolute z-50 bg-main-view border border-main-view-fg/15 rounded-xl shadow-2xl max-w-md max-h-96 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header with gradient background */}
      <div className="relative px-3 py-2.5 bg-gradient-to-r from-primary/5 to-accent/5 border-b border-main-view-fg/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles size={16} className="text-primary" />
            <span className="text-xs font-medium text-main-view-fg">
              Prompt Templates
            </span>
          </div>
          <span className="text-xs text-main-view-fg/50 bg-main-view-fg/5 px-2 py-0.5 rounded-full">
            {suggestions.length} available
          </span>
        </div>
      </div>

      {/* Scrollable suggestions list */}
      <div className="overflow-y-auto max-h-80 scroll-smooth [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-main-view-fg/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-main-view-fg/30">
        {suggestions.map((template, index) => {
          const isSelected = index === selectedIndex
          const iconColor =
            template.source === 'mcp' ? 'text-primary' : 'text-accent'

          return (
            <div
              key={template.id}
              onClick={() => onSelect(template)}
              className={`
                group relative px-3 py-3 cursor-pointer transition-all duration-150
                ${
                  isSelected
                    ? 'bg-gradient-to-r from-primary/10 to-accent/10 border-l-2 border-primary shadow-sm'
                    : 'hover:bg-main-view-fg/5 border-l-2 border-transparent'
                }
              `}
            >
              <div className="flex items-start gap-2.5">
                {/* Icon with animated background on hover */}
                <div
                  className={`
                  mt-0.5 p-1.5 rounded-md transition-all
                  ${
                    isSelected
                      ? 'bg-primary/15'
                      : 'bg-main-view-fg/5 group-hover:bg-main-view-fg/10'
                  }
                `}
                >
                  {template.source === 'mcp' ? (
                    <IconBolt size={14} className={iconColor} />
                  ) : (
                    <IconSparkles size={14} className={iconColor} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Title row with trigger and category */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`
                      font-semibold text-sm transition-colors
                      ${isSelected ? 'text-primary' : 'text-main-view-fg group-hover:text-main-view-fg'}
                    `}
                    >
                      /{template.trigger}
                    </span>
                    {template.category && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-main-view-fg/10 text-main-view-fg/70 border border-main-view-fg/10">
                        {template.category}
                      </span>
                    )}
                  </div>

                  {/* Description with better line clamping */}
                  <p className="text-xs text-main-view-fg/70 leading-relaxed line-clamp-2">
                    {template.description}
                  </p>

                  {/* Variables with improved styling */}
                  {template.variables && template.variables.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {template.variables.map((v) => (
                        <span
                          key={v}
                          className="text-xs px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20 font-mono"
                        >
                          {`{${v}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selection indicator */}
                {isSelected && (
                  <div className="mt-1 text-primary animate-in fade-in duration-150">
                    <IconArrowsDiagonal size={14} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer with keyboard shortcuts - subtle gradient */}
      <div className="px-3 py-2 bg-gradient-to-r from-main-view-fg/3 to-main-view-fg/5 border-t border-main-view-fg/10">
        <div className="flex items-center justify-between text-xs text-main-view-fg/60">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 border border-main-view-fg/20 rounded text-[10px] font-mono">
              ↑↓
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 border border-main-view-fg/20 rounded text-[10px] font-mono">
              ⏎
            </kbd>
            <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 border border-main-view-fg/20 rounded text-[10px] font-mono">
              Tab
            </kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 border border-main-view-fg/20 rounded text-[10px] font-mono">
              Esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  )
}
