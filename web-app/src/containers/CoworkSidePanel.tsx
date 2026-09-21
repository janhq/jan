import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

type CoworkSidePanelProps = {
  title: ReactNode
  leading?: ReactNode
  summary?: ReactNode
  children: ReactNode
  onClose: () => void
}

const PANEL_MIN_W = 240
const PANEL_DEFAULT_W = 320
/** One width across the preview/diff/todo/tasks panels, kept across sessions. */
const PANEL_WIDTH_KEY = 'cowork:sidePanelWidth'

/** The panel may grow with the window but never crush the transcript. */
function panelMaxWidth(): number {
  return Math.max(PANEL_MIN_W, Math.round(window.innerWidth * 0.7))
}

function clampWidth(w: number): number {
  return Math.min(panelMaxWidth(), Math.max(PANEL_MIN_W, Math.round(w)))
}

function storedWidth(): number {
  const raw = Number(window.localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(raw) && raw >= PANEL_MIN_W
    ? clampWidth(raw)
    : PANEL_DEFAULT_W
}

export function CoworkSidePanel({
  title,
  leading,
  summary,
  children,
  onClose,
}: CoworkSidePanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [width, setWidth] = useState(storedWidth)
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const widthRef = useRef(width)

  // Pointer capture keeps move events flowing to the handle even while the
  // pointer crosses the preview's iframe, which otherwise swallows them and
  // freezes the drag mid-resize.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      const pointerId = e.pointerId
      const startX = e.clientX
      // Measure the rendered width so a drag that starts while expanded picks
      // up from the size on screen instead of a stale state value.
      const startW =
        asideRef.current?.getBoundingClientRect().width ?? widthRef.current
      setExpanded(false)
      setResizing(true)
      handle.setPointerCapture(pointerId)
      const onMove = (ev: PointerEvent) => {
        const next = clampWidth(startW + (startX - ev.clientX)) // left edge -> drag left = wider
        widthRef.current = next
        setWidth(next)
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId)
        }
        setResizing(false)
        window.localStorage.setItem(PANEL_WIDTH_KEY, String(widthRef.current))
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    []
  )

  const resetWidth = useCallback(() => {
    widthRef.current = PANEL_DEFAULT_W
    setWidth(PANEL_DEFAULT_W)
    setExpanded(false)
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(PANEL_DEFAULT_W))
  }, [])

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full max-w-[70%] shrink-0 flex-col border-l bg-main-view"
      // Expanded takes everything the max-width cap allows, so it can only
      // grow the panel; a dragged width is honored otherwise.
      style={{ width: expanded ? '70%' : `${width}px` }}
    >
      {/* Resize handle: thin invisible strip on the left edge. Double-click
          resets to the default width. */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onDoubleClick={resetWidth}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none bg-main-view-fg/0 transition-colors hover:bg-main-view-fg/20"
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
      {/* An iframe under the pointer would steal the drag on WebKit even with
          pointer capture, so the body goes inert while resizing. */}
      <div className={cn('min-h-0 flex-1', resizing && 'pointer-events-none select-none')}>
        {children}
      </div>
    </aside>
  )
}
