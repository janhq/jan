import { useEffect, useId, useRef, useState } from 'react'
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

  // Auto-open once this artifact's first generation settles; skip historical blocks.
  const autoOpenedRef = useRef(false)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (generating) {
      wasGeneratingRef.current = true
      return
    }
    if (wasGeneratingRef.current && !autoOpenedRef.current && code) {
      autoOpenedRef.current = true
      open(id, code, false)
    }
  }, [generating, code, id, open])

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
        'my-4 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-input bg-white p-3 text-left transition-colors hover:border-ring/60 dark:bg-input/30 dark:hover:border-ring/60',
        isActive && 'border-primary/50',
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

// On Windows the custom caption controls (min/max/close) sit in the top-right
// corner of the panel and consume ~120px, so the minimum must be wider.
const MIN_PANEL_WIDTH = IS_WINDOWS ? 480 : 380
// Keep at least this much room for the chat column when resizing the panel.
const MIN_CHAT_WIDTH = MIN_PANEL_WIDTH + 100
// Matches the `duration-300` slide in/out below.
const PANEL_ANIM_MS = 300

function clampPanelWidth(px: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, window.innerWidth - MIN_CHAT_WIDTH)
  return Math.min(max, Math.max(MIN_PANEL_WIDTH, px))
}

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

  const [width, setWidth] = useState(() =>
    clampPanelWidth(window.innerWidth * 0.45)
  )
  const [dragging, setDragging] = useState(false)

  // Animate width (not transform) so the chat reflows; transition only while animating.
  const [render, setRender] = useState(isOpen)
  const [expanded, setExpanded] = useState(false)
  const [animating, setAnimating] = useState(false)
  useEffect(() => {
    if (isOpen) {
      setRender(true)
      setAnimating(true)
      // Double rAF so the width:0 frame paints before transitioning to target.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setExpanded(true))
      })
      const t = setTimeout(() => setAnimating(false), PANEL_ANIM_MS + 60)
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
        clearTimeout(t)
      }
    }
    setAnimating(true)
    setExpanded(false)
    const t = setTimeout(() => {
      setRender(false)
      setAnimating(false)
    }, PANEL_ANIM_MS)
    return () => clearTimeout(t)
  }, [isOpen])

  // Overlay (below) keeps mousemove/up firing while the iframe swallows pointer events.
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) =>
      setWidth(clampPanelWidth(window.innerWidth - e.clientX))
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  // Freeze last artifact so content stays visible through the exit animation.
  const lastShownRef = useRef({ sourceId, code, streaming })
  if (isOpen) lastShownRef.current = { sourceId, code, streaming }
  const view = isOpen ? { sourceId, code, streaming } : lastShownRef.current

  if (!render) return null

  return (
    <div
      className={cn(
        'relative hidden h-full shrink-0 overflow-hidden border-border border-l md:flex',
        animating && 'transition-[width,opacity] duration-300 ease-out'
      )}
      style={{ width: expanded ? width : 0, opacity: expanded ? 1 : 0 }}
    >
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        className="-left-1 absolute top-0 z-40 h-full w-2 cursor-col-resize transition-colors hover:bg-primary/30"
        title="Drag to resize"
      />
      {dragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none" />
      )}
      <HtmlArtifact
        key={view.sourceId ?? 'artifact'}
        code={view.code}
        streaming={view.streaming}
        fill
        onClose={close}
        className="flex-1"
      />
    </div>
  )
}
