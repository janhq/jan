import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { TITLEBAR_HEIGHT } from '@/stores/titlebar-layout-store'
import { useTranslation } from '@/i18n/react-i18next-compat'

type CoworkSidePanelProps = {
  title: ReactNode
  leading?: ReactNode
  summary?: ReactNode
  children: ReactNode
  onClose: () => void
}

/** Shared 32px rail actions keep preview and panel controls aligned. */
export function CoworkPanelButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button type="button" variant="ghost" size="icon-sm" {...props}
    className={cn('rounded-md text-main-view-fg/70 hover:bg-main-view-fg/10 hover:text-main-view-fg data-[state=open]:bg-main-view-fg/10 dark:hover:bg-main-view-fg/10', className)} />
}

const PANEL_MIN_W = 320
const TRANSCRIPT_MIN_W = 480
const RESIZE_STEP = 16
/** One user preference across preview/diff/todo/tasks, not a measured width. */
const PANEL_WIDTH_KEY = 'cowork:sidePanelWidthRatio'
const LEGACY_WIDTH_KEY = 'cowork:sidePanelWidth'

function storedWidth(): number | null {
  try {
    const raw = Number(window.localStorage.getItem(PANEL_WIDTH_KEY))
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : null
  } catch { return null }
}

function persistWidth(width: number | null) {
  try {
    if (width === null) {
      window.localStorage.removeItem(PANEL_WIDTH_KEY)
      window.localStorage.removeItem(LEGACY_WIDTH_KEY)
    }
    else window.localStorage.setItem(PANEL_WIDTH_KEY, String(width))
  } catch { /* Storage can be unavailable or full; resizing must still work. */ }
}

export function CoworkSidePanel({
  title,
  leading,
  summary,
  children,
  onClose,
}: CoworkSidePanelProps): React.ReactElement {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const [preferredRatio, setPreferredRatio] = useState(storedWidth)
  const [parentWidth, setParentWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  const phone = useMediaQuery('(max-width: 640px)', false)
  const overlay = parentWidth > 0 && parentWidth < PANEL_MIN_W + TRANSCRIPT_MIN_W
  const minWidth = overlay ? parentWidth : PANEL_MIN_W
  const maxWidth = overlay ? parentWidth : parentWidth - TRANSCRIPT_MIN_W
  const clampWidth = useCallback((value: number) => (
    Math.min(maxWidth, Math.max(minWidth, Math.round(value)))
  ), [minWidth, maxWidth])
  const width = overlay || expanded ? maxWidth : clampWidth(parentWidth * (preferredRatio ?? 0.5))

  useLayoutEffect(() => {
    const parent = asideRef.current?.parentElement
    if (!parent) return
    // The containing block is the remaining content area, never the viewport
    // (which includes the navigation sidebar). Keep the overlay below its header.
    const previousPosition = parent.style.position
    const needsPosition = getComputedStyle(parent).position === 'static' || !getComputedStyle(parent).position
    if (needsPosition) parent.style.position = 'relative'
    let migrated = false
    const measure = () => {
      const available = parent.getBoundingClientRect().width
      setParentWidth(available)
      if (!migrated && available > 0) {
        migrated = true
        try {
          const legacy = Number(window.localStorage.getItem(LEGACY_WIDTH_KEY))
          if (storedWidth() === null && Number.isFinite(legacy) && legacy > 0) {
            const ratio = Math.min(1, legacy / available)
            setPreferredRatio(ratio)
            persistWidth(ratio)
          }
        } catch { /* unavailable */ }
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => {
      observer.disconnect()
      if (needsPosition) parent.style.position = previousPosition
    }
  }, [])

  // Cancel an active drag if its geometry changes or the panel unmounts.
  useEffect(() => {
    return () => { dragCleanup.current?.() }
  }, [parentWidth])

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!overlay) return
    const panel = asideRef.current
    if (!panel) return
    const previousFocus = document.activeElement as HTMLElement | null
    const siblings = Array.from(panel.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== panel)
    const previousInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"], audio[controls], video[controls], summary'
    )).filter((element) => !element.closest('[inert]') && !element.hidden)
    ;(focusable()[0] ?? panel).focus()
    // Dropdowns render in a portal, outside the aside. Keep keyboard focus in
    // menus owned by this panel rather than pulling it back to the header.
    const ownsPortalFocus = (target: EventTarget | null) => target instanceof Node &&
      Array.from(panel.querySelectorAll('[aria-controls]')).some((trigger) => {
        const controlled = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
        return controlled?.contains(target)
      })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[data-state="open"][role="menu"], [data-state="open"][data-slot="popover-content"]')) {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      } else if (event.key === 'Tab' && !ownsPortalFocus(event.target)) {
        const elements = focusable()
        const index = elements.indexOf(document.activeElement as HTMLElement)
        if (!elements.length || (event.shiftKey ? index <= 0 : index === elements.length - 1 || index < 0)) {
          event.preventDefault()
          ;(event.shiftKey ? elements.at(-1) ?? panel : elements[0] ?? panel).focus()
        }
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node) && !ownsPortalFocus(event.target)) (focusable()[0] ?? panel).focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      siblings.forEach((element, index) => { element.inert = previousInert[index] })
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [overlay])

  const commitWidth = useCallback((value: number) => {
    if (parentWidth <= 0) return
    const next = clampWidth(value)
    setExpanded(false)
    setPreferredRatio(next / parentWidth)
    persistWidth(next / parentWidth)
  }, [clampWidth, parentWidth])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (overlay || e.button !== 0 || e.isPrimary === false) return
      e.preventDefault()
      dragCleanup.current?.()
      const handle = e.currentTarget
      handle.focus()
      const pointerId = e.pointerId
      const startX = e.clientX
      const startW = asideRef.current?.getBoundingClientRect().width ?? width
      let next = clampWidth(startW)
      setExpanded(false)
      setPreferredRatio(next / parentWidth)
      setResizing(true)
      handle.setPointerCapture(pointerId)
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        next = clampWidth(startW + startX - ev.clientX)
        setPreferredRatio(next / parentWidth)
      }
      const cleanup = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onEnd)
        handle.removeEventListener('pointercancel', onEnd)
        handle.removeEventListener('lostpointercapture', onEnd)
        dragCleanup.current = null
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        setResizing(false)
      }
      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        cleanup()
        persistWidth(next / parentWidth)
      }
      dragCleanup.current = cleanup
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onEnd)
      handle.addEventListener('pointercancel', onEnd)
      handle.addEventListener('lostpointercapture', onEnd)
    },
    [clampWidth, overlay, width, parentWidth]
  )

  const resetWidth = useCallback(() => {
    dragCleanup.current?.()
    setPreferredRatio(null)
    setExpanded(false)
    persistWidth(null)
  }, [])

  return (
    <motion.aside
      ref={asideRef}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay || undefined}
      aria-label={overlay ? t('common:overview.title') : undefined}
      tabIndex={-1}
      // Keep every rail below body-portalled menus, including its opacity animation.
      className={cn('z-(--layer-panel) flex min-w-0 shrink-0 flex-col border-l bg-main-view', overlay ? (phone ? 'fixed inset-x-0 bottom-0' : 'absolute inset-y-0 right-0 h-full') : 'relative h-full')}
      style={overlay && phone ? { top: TITLEBAR_HEIGHT } : undefined}
      initial={reduceMotion ? false : { width: 0, opacity: 0 }}
      animate={{ width: overlay && phone ? '100vw' : width, opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0, pointerEvents: 'none' }}
      transition={{ duration: reduceMotion || resizing ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        role="separator"
        tabIndex={overlay ? -1 : 0}
        aria-label={t('common:overview.resize')}
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels`}
        aria-disabled={overlay}
        onPointerDown={onPointerDown}
        onDoubleClick={resetWidth}
        onKeyDown={(event) => {
          if (overlay) return
          const next = event.key === 'Home' ? minWidth
            : event.key === 'End' ? maxWidth
              : event.key === 'ArrowLeft' ? width + RESIZE_STEP
                : event.key === 'ArrowRight' ? width - RESIZE_STEP : null
          if (next === null) return
          event.preventDefault()
          commitWidth(next)
        }}
        className={cn('absolute inset-y-0 left-0 z-10 w-1.5 touch-none bg-main-view-fg/0 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', !overlay && 'cursor-col-resize hover:bg-main-view-fg/20')}
      />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-main-view-fg/10 bg-main-view-fg/[0.025] px-3 text-main-view-fg">
        {leading}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {summary}
          <CoworkPanelButton
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? t('common:collapse') : t('common:expand')}
            aria-pressed={expanded}
            title={expanded ? t('common:collapse') : t('common:expand')}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </CoworkPanelButton>
          <CoworkPanelButton
            onClick={onClose}
            aria-label={t('common:close')}
            title={t('common:close')}
          >
            <X className="size-4" />
          </CoworkPanelButton>
        </div>
      </div>
      {/* Pointer capture alone is insufficient for iframe crossings on WebKit. */}
      <div inert={resizing || undefined} className={cn('min-h-0 flex-1', resizing && 'pointer-events-none select-none')}>
        {children}
      </div>
    </motion.aside>
  )
}
