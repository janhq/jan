import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

type CodeSidePanelProps = {
  title: ReactNode
  leading?: ReactNode
  summary?: ReactNode
  children: ReactNode
  onClose: () => void
}

const PANEL_MIN_W = 240
const PANEL_MAX_W = 640
const PANEL_DEFAULT_W = 320

export function CodeSidePanel({
  title,
  leading,
  summary,
  children,
  onClose,
}: CodeSidePanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [width, setWidth] = useState(PANEL_DEFAULT_W)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startW.current = expanded ? PANEL_MAX_W : width
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const delta = startX.current - ev.clientX // left edge -> drag left = wider
        const next = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, startW.current + delta))
        setWidth(next)
      }
      const onUp = () => {
        dragging.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [expanded, width]
  )

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-l bg-main-view',
        expanded ? 'w-[32rem] max-w-[60%]' : ''
      )}
      style={expanded ? undefined : { width: `${width}px` }}
    >
      {/* Resize handle – thin invisible strip on the left edge. */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-main-view-fg/0 transition-colors hover:bg-main-view-fg/20"
      />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {leading}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {summary}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? t('common:collapse') : t('common:expand')}
          title={expanded ? t('common:collapse') : t('common:expand')}
          className="text-main-view-fg/60 hover:text-main-view-fg"
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common:close')}
          className="text-main-view-fg/60 hover:text-main-view-fg"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  )
}
