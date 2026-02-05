import { useMemo } from 'react'
import { IconSparkles, IconArrowRight } from '@tabler/icons-react'
import { diffWords } from 'diff'

interface DiffChange {
  type: 'add' | 'remove' | 'neutral'
  text: string
  reason?: string
}

interface EnhancementDiffViewProps {
  original: string
  enhanced: string
  improvements: string[]
  reasoning: string
}

export function EnhancementDiffView({
  original,
  enhanced,
  improvements,
  reasoning,
}: EnhancementDiffViewProps) {
  const changes = useMemo(() => {
    const diff = diffWords(original, enhanced)
    return diff.map((part): DiffChange => {
      if (part.added) return { type: 'add', text: part.value }
      if (part.removed) return { type: 'remove', text: part.value }
      return { type: 'neutral', text: part.value }
    })
  }, [original, enhanced])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-main-view-fg/10">
        <IconSparkles size={16} className="text-purple-500" />
        <h3 className="font-medium text-sm">Enhancement Comparison</h3>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-main-view-fg/60">
            <span className="font-medium">Original</span>
            <IconArrowRight size={14} />
            <span className="font-medium text-purple-500">Enhanced</span>
          </div>

          <div className="p-3 rounded-lg bg-main-view-fg/5 border border-main-view-fg/10">
            <div className="text-sm leading-relaxed break-words">
              {changes.map((change, idx) => {
                if (change.type === 'neutral') {
                  return (
                    <span key={idx} className="text-main-view-fg/80">
                      {change.text}
                    </span>
                  )
                }
                if (change.type === 'remove') {
                  return (
                    <span
                      key={idx}
                      className="bg-red-500/20 text-red-500 line-through px-0.5 rounded"
                      title="Removed"
                    >
                      {change.text}
                    </span>
                  )
                }
                if (change.type === 'add') {
                  return (
                    <span
                      key={idx}
                      className="bg-green-500/20 text-green-500 font-medium px-0.5 rounded"
                      title="Added"
                    >
                      {change.text}
                    </span>
                  )
                }
                return null
              })}
            </div>
          </div>
        </div>

        {improvements.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-main-view-fg/60">
              Key Improvements
            </h4>
            <ul className="space-y-1.5">
              {improvements.map((improvement, idx) => (
                <li
                  key={idx}
                  className="text-xs text-main-view-fg/70 flex items-start gap-2"
                >
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>{improvement}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {reasoning && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-main-view-fg/60">
              AI Reasoning
            </h4>
            <p className="text-xs text-main-view-fg/70 leading-relaxed p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
              {reasoning}
            </p>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-main-view-fg/10">
        <div className="flex items-center gap-4 text-xs text-main-view-fg/50">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 bg-green-500/20 border border-green-500/40 rounded"></span>
            <span>Added</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 bg-red-500/20 border border-red-500/40 rounded line-through"></span>
            <span>Removed</span>
          </div>
        </div>
      </div>
    </div>
  )
}
