import { useEffect, useId, useState } from 'react'
import { Code2, Eye } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { useArtifactStore } from '@/stores/artifact-store'
import { HtmlArtifact, estimateHtmlProgress } from './HtmlArtifact'

interface ArtifactTriggerProps {
  code: string
  className?: string
  streaming?: boolean
}

// Inline card shown in place of a ```html block; opens the side-panel preview.
export function ArtifactTrigger({
  code,
  className,
  streaming = false,
}: ArtifactTriggerProps) {
  const id = useId()
  const open = useArtifactStore((s) => s.open)
  const update = useArtifactStore((s) => s.update)
  const isActive = useArtifactStore((s) => s.isOpen && s.sourceId === id)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    update(id, code, streaming)
  }, [id, code, streaming, update])

  // Closing tag marks completion even if the `streaming` flag stays stuck true.
  const generating = streaming && !/<\/html>/i.test(code)

  useEffect(() => {
    if (!generating) return
    const target = estimateHtmlProgress(code)
    setProgress((previous) => Math.max(previous, target))
  }, [code, generating])

  const progressPct = Math.round(progress * 100)
  const subtitle = generating
    ? `Generating preview… ${progressPct}%`
    : isActive
      ? 'Showing in panel'
      : 'Click to open the live preview'

  return (
    <button
      type="button"
      onClick={() => open(id, code, streaming)}
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
        <div className="truncate text-muted-foreground text-xs">{subtitle}</div>
        {generating && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>
      {!generating && (
        <Eye size={16} className="shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}

// Side panel hosting the live HTML preview; hidden on small screens.
export function ArtifactPanel() {
  const { isOpen, sourceId, code, streaming, close } = useArtifactStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      sourceId: s.sourceId,
      code: s.code,
      streaming: s.streaming,
      close: s.close,
    }))
  )

  if (!isOpen) return null

  return (
    <div className="hidden h-full w-[45%] min-w-[360px] max-w-[680px] shrink-0 border-border border-l md:flex">
      <HtmlArtifact
        key={sourceId ?? 'artifact'}
        code={code}
        streaming={streaming}
        fill
        onClose={close}
        className="flex-1"
      />
    </div>
  )
}
