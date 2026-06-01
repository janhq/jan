import { useEffect, useId } from 'react'
import { Code2, Eye } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { useArtifactStore } from '@/stores/artifact-store'
import { HtmlArtifact } from './HtmlArtifact'

interface ArtifactTriggerProps {
  code: string
  className?: string
}

/**
 * Compact inline card rendered in place of a ```html code block. Clicking it
 * opens the live preview in the side panel. While bound to the open panel it
 * keeps the preview in sync with streaming output.
 */
export function ArtifactTrigger({ code, className }: ArtifactTriggerProps) {
  const id = useId()
  const open = useArtifactStore((s) => s.open)
  const update = useArtifactStore((s) => s.update)
  const isActive = useArtifactStore(
    (s) => s.isOpen && s.sourceId === id
  )

  // No-ops unless this card is the artifact currently shown in the panel.
  useEffect(() => {
    update(id, code)
  }, [id, code, update])

  return (
    <button
      type="button"
      onClick={() => open(id, code)}
      className={cn(
        'my-4 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/40 p-3 text-left transition-colors hover:bg-muted/70',
        isActive && 'border-primary/50 bg-muted/70',
        className
      )}
      data-artifact-trigger="html"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        <Code2 size={18} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">HTML preview</div>
        <div className="truncate text-muted-foreground text-xs">
          {isActive ? 'Showing in panel' : 'Click to open the live preview'}
        </div>
      </div>
      <Eye size={16} className="shrink-0 text-muted-foreground" />
    </button>
  )
}

/**
 * Side panel that hosts the live HTML artifact preview next to the chat.
 * Renders nothing until an artifact is opened. Hidden on small screens.
 */
export function ArtifactPanel() {
  const { isOpen, code, close } = useArtifactStore(
    useShallow((s) => ({ isOpen: s.isOpen, code: s.code, close: s.close }))
  )

  if (!isOpen) return null

  return (
    <div className="hidden h-full w-[45%] min-w-[360px] max-w-[680px] shrink-0 border-border border-l md:flex">
      <HtmlArtifact code={code} fill onClose={close} className="flex-1" />
    </div>
  )
}
