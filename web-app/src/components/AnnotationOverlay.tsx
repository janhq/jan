/**
 * Annotation overlay for artifact previews.
 *
 * When `active`, renders a single-row toolbar above the preview and a
 * transparent Konva Stage over it: element inspection (select), freehand
 * pencil, arrow, and numbered notes.
 *
 * What the model receives
 * -----------------------
 * The Stage is a transparent layer floating over a `sandbox="allow-scripts"`
 * iframe with an opaque origin, so `stage.toDataURL()` alone yields marks on
 * nothing — no page pixels are in it and nothing in the webview can rasterize
 * that iframe. `captureBase` supplies the pixels underneath (headless Chrome,
 * via the `agent_render_preview` command) at exactly the Stage's size, and
 * `handleSend` composites base + marks into one PNG. If the capture fails the
 * send stops and says so rather than shipping a blank background.
 *
 * Interaction rules learned the hard way
 * --------------------------------------
 * - Notes are opt-in. Finishing a stroke or pinning an element never steals
 *   focus with an input; it offers a "+" affordance you can ignore.
 * - Colour/width live in a popover and only exist for drawing tools, so the
 *   toolbar stays one row at the 240px minimum panel width.
 * - The send/cancel pill only appears once there is something to send, so it
 *   isn't covering the preview while you work.
 *
 * Layout note: the toolbar is a sibling of the content wrapper (which stays a
 * flex child of the panel), so the preview's scroll container keeps its
 * `flex-1 overflow-auto` behavior while annotation mode is on — the Stage only
 * overlays the visible content box.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Loader2,
  MessageSquarePlus,
  MousePointer2,
  Pencil,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { Stage, Layer, Line, Arrow, Text, Circle, Rect, Group } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type AnnotationTool = 'select' | 'pencil' | 'arrow' | 'text'

interface Point { x: number; y: number }

interface PencilStroke {
  tool: 'pencil'
  points: number[]
  color: string
  width: number
}

interface ArrowShape {
  tool: 'arrow'
  start: Point
  end: Point
  color: string
  width: number
}

/** A committed note: a numbered card with a leader line back to its anchor. */
interface NoteShape {
  tool: 'note'
  pos: Point
  text: string
  color: string
}

type AnnotationShape = PencilStroke | ArrowShape | NoteShape

interface AnnotationOverlayProps {
  /** Whether annotation mode is active. */
  active: boolean
  /**
   * Renders the preview underneath the marks at `width`x`height` CSS pixels
   * and `scale` device pixels per CSS pixel, resolving a PNG data URL.
   * Rejecting (or resolving null) blocks the send with a visible reason — the
   * marks alone are not a useful payload.
   */
  captureBase?: (
    width: number,
    height: number,
    scale: number
  ) => Promise<string | null>
  /** Called with the composited PNG data URL when the user sends. */
  onSend: (dataUrl: string) => void
  /** Called when the user cancels annotation mode. */
  onCancel: () => void
  children: React.ReactNode
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7']
const STROKE_WIDTHS = [2, 3, 5]
const DEFAULT_COLOR = '#ef4444'
const NOTE_FONT = 'system-ui, sans-serif'
const NOTE_FONT_SIZE = 12.5
const NOTE_LINE_HEIGHT = 1.35
const NOTE_PAD = 8
/** Card width, and the text column inside it (the badge takes the rest). */
const NOTE_W = 168
const NOTE_TEXT_W = 128
const NOTE_MAX_LINES = 6

const TOOL_KEYS: Record<string, AnnotationTool> = {
  v: 'select',
  p: 'pencil',
  a: 'arrow',
  t: 'text',
}

/**
 * Card height for `text`, from a greedy character-count wrap.
 *
 * ponytail: an estimate, not a measurement — measuring exactly needs an
 * offscreen `new Konva.Text(...)`, which drags the canvas backend into jsdom
 * tests. Konva wraps the real text to `NOTE_TEXT_W` regardless; this only sizes
 * the card behind it, and it rounds up. Swap in a real measure if a font change
 * ever makes cards visibly too tall.
 */
function noteHeight(text: string): number {
  const perLine = Math.max(8, Math.floor(NOTE_TEXT_W / (NOTE_FONT_SIZE * 0.5)))
  let lines = 1
  let len = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (len && len + 1 + word.length > perLine) {
      lines++
      len = word.length
    } else {
      len += (len ? 1 : 0) + word.length
    }
  }
  return (
    NOTE_PAD * 2 +
    Math.min(lines, NOTE_MAX_LINES) * Math.round(NOTE_FONT_SIZE * NOTE_LINE_HEIGHT)
  )
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi))

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to decode'))
    img.src = src
  })
}

export function AnnotationOverlay({
  active,
  captureBase,
  onSend,
  onCancel,
  children,
}: AnnotationOverlayProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [shapes, setShapes] = useState<AnnotationShape[]>([])
  const [drawing, setDrawing] = useState(false)
  const [currentLine, setCurrentLine] = useState<number[]>([])
  const [arrowStart, setArrowStart] = useState<Point | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  /** Open note input. Nothing is committed to `shapes` until it is confirmed. */
  const [draft, setDraft] = useState<Point | null>(null)
  /** Opt-in "add a note here" affordance left at the tip of the last stroke. */
  const [markHint, setMarkHint] = useState<Point | null>(null)
  /** Element pinned by the in-iframe inspector, with its CSS-ish selector. */
  const [pinned, setPinned] = useState<{ anchor: Point; label: string } | null>(null)
  const [sending, setSending] = useState(false)
  /** Set when `captureBase` could not produce the pixels under the marks. */
  const [captureError, setCaptureError] = useState<string | null>(null)

  const hasWork = shapes.length > 0

  // Track the visible content box while active; the Stage overlays exactly
  // this area (toolbar excluded) and the base render uses the same size.
  useEffect(() => {
    if (!active || !contentRef.current) return
    const el = contentRef.current
    const update = () =>
      setDimensions({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [active])

  const reset = useCallback(() => {
    setShapes([])
    setCurrentLine([])
    setArrowStart(null)
    setDraft(null)
    setMarkHint(null)
    setPinned(null)
    setCaptureError(null)
  }, [])

  const exit = useCallback(() => {
    reset()
    onCancel()
  }, [reset, onCancel])

  const undo = useCallback(() => {
    setShapes((prev) => prev.slice(0, -1))
    setMarkHint(null)
  }, [])

  // Leaving annotation mode drops everything in flight.
  useEffect(() => {
    if (!active) reset()
  }, [active, reset])

  // The in-iframe inspector reports the pinned element's bbox + selector. It
  // only marks the element — the note is offered, never forced.
  useEffect(() => {
    if (!active) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | {
            source?: string
            type?: string
            label?: string
            rect?: { x: number; y: number; width: number; height: number }
          }
        | null
      if (!data || data.source !== 'jan-preview-inspector') return
      if (data.type === 'clear') {
        setPinned(null)
        return
      }
      if (data.type !== 'pin' || !data.rect) return

      // Only the iframe this overlay wraps may drive the pin.
      const iframe = contentRef.current?.querySelector('iframe')
      if (iframe && e.source !== iframe.contentWindow) return

      // Convert iframe-viewport coords to stage coords (accounts for the
      // iframe's offset inside the content box).
      const box = contentRef.current?.getBoundingClientRect()
      const frameRect = iframe?.getBoundingClientRect()
      let x = data.rect.x
      let y = data.rect.y
      if (box && frameRect) {
        x = frameRect.left - box.left + data.rect.x
        y = frameRect.top - box.top + data.rect.y
      }
      setPinned({
        anchor: { x: x + data.rect.width, y },
        label: data.label ?? 'element',
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  // Any tool but select drops the inspector's pinned bbox: it is drawn inside
  // the iframe, so it would otherwise sit under the user's strokes with no way
  // to dismiss it.
  useEffect(() => {
    if (!active || tool === 'select') return
    setPinned(null)
    contentRef.current
      ?.querySelector('iframe')
      ?.contentWindow?.postMessage(
        { source: 'jan-annotation-overlay', type: 'clear' },
        '*'
      )
  }, [active, tool])

  // Keyboard: tool switching, undo, send, exit. Ignored while typing a note.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (e.key === 'Escape') {
        if (typing) return // the note input handles its own Escape
        if (draft) setDraft(null)
        else exit()
        return
      }
      if (typing) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const next = TOOL_KEYS[e.key.toLowerCase()]
      if (next) {
        e.preventDefault()
        setTool(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, draft, exit, undo])

  const getPointerPos = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>): Point => {
      const stage = e.target.getStage?.()
      if (!stage) return { x: 0, y: 0 }
      return stage.getPointerPosition() ?? { x: 0, y: 0 }
    },
    []
  )

  const handlePointerDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!active) return
      const pos = getPointerPos(e)
      setMarkHint(null)

      if (tool === 'pencil') {
        setDrawing(true)
        setCurrentLine([pos.x, pos.y])
      } else if (tool === 'arrow') {
        setDrawing(true)
        setArrowStart(pos)
      } else if (tool === 'text') {
        setDraft(pos)
      }
    },
    [active, tool, getPointerPos]
  )

  const handlePointerMove = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!drawing || !active) return
      const pos = getPointerPos(e)
      if (tool === 'pencil') {
        setCurrentLine((prev) => {
          // Skip points closer than 2px: fewer, further-apart points make the
          // tension curve read as a smooth line instead of a jittery one.
          if (prev.length >= 2) {
            const dx = pos.x - prev[prev.length - 2]
            const dy = pos.y - prev[prev.length - 1]
            if (dx * dx + dy * dy < 4) return prev
          }
          return [...prev, pos.x, pos.y]
        })
      }
    },
    [drawing, active, tool, getPointerPos]
  )

  const handlePointerUp = useCallback(() => {
    if (!drawing) return
    setDrawing(false)

    // A finished mark offers a note at its tip; it never opens one.
    if (tool === 'pencil' && currentLine.length >= 4) {
      const pts = currentLine
      setShapes((prev) => [
        ...prev,
        { tool: 'pencil', points: pts, color, width: strokeWidth },
      ])
      setMarkHint({ x: pts[pts.length - 2], y: pts[pts.length - 1] })
    } else if (tool === 'arrow' && arrowStart) {
      const end = stageRef.current?.getPointerPosition() ?? arrowStart
      const moved =
        Math.abs(end.x - arrowStart.x) > 4 || Math.abs(end.y - arrowStart.y) > 4
      if (moved) {
        setShapes((prev) => [
          ...prev,
          { tool: 'arrow', start: arrowStart, end, color, width: strokeWidth },
        ])
        setMarkHint(end)
      }
    }
    setCurrentLine([])
    setArrowStart(null)
  }, [drawing, tool, currentLine, arrowStart, color, strokeWidth])

  const commitNote = useCallback(
    (text: string) => {
      const pos = draft
      setDraft(null)
      if (!pos || !text.trim()) return
      setShapes((prev) => [
        ...prev,
        { tool: 'note', pos, text: text.trim(), color },
      ])
      setMarkHint(null)
    },
    [draft, color]
  )

  /**
   * Composite the base render and the mark layer into one PNG.
   *
   * `skipBase` is the explicit second click after a capture failure: the user
   * has been told the page pixels are missing and chose to send the marks
   * alone (the model still has the source file).
   */
  const send = useCallback(
    async (skipBase: boolean) => {
      const stage = stageRef.current
      if (!stage || sending) return
      const width = dimensions.width || stage.width()
      const height = dimensions.height || stage.height()
      if (!width || !height) return

      setSending(true)
      setCaptureError(null)
      const dpr = window.devicePixelRatio || 1
      try {
        let base: HTMLImageElement | null = null
        if (!skipBase && captureBase) {
          try {
            const url = await captureBase(
              Math.round(width),
              Math.round(height),
              dpr
            )
            if (!url) throw new Error('this preview cannot be rendered to an image')
            base = await loadImage(url)
          } catch (err) {
            setCaptureError(err instanceof Error ? err.message : String(err))
            return
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        // White under everything: a transparent PNG reads as a blank image in
        // most chat renderers, and the base render may itself be transparent.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (base) ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
        const marks = await loadImage(
          stage.toDataURL({ mimeType: 'image/png', pixelRatio: dpr })
        )
        ctx.drawImage(marks, 0, 0, canvas.width, canvas.height)

        onSend(canvas.toDataURL('image/png'))
        reset()
        onCancel()
      } finally {
        setSending(false)
      }
    },
    [sending, dimensions, captureBase, onSend, onCancel, reset]
  )

  // Cmd/Ctrl+Enter sends. Registered separately so it also fires from inside
  // the note input, where the other shortcuts are suppressed.
  useEffect(() => {
    if (!active || !hasWork) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void send(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, hasWork, send])

  const noteIndexOf = useMemo(() => {
    const map = new Map<number, number>()
    let n = 0
    shapes.forEach((s, i) => {
      if (s.tool === 'note') map.set(i, ++n)
    })
    return map
  }, [shapes])

  if (!active) {
    return <>{children}</>
  }

  const stageW = dimensions.width || 400
  const stageH = dimensions.height || 300

  // Live preview of the in-progress shape.
  const previewShapes: React.ReactNode[] = []
  if (tool === 'pencil' && drawing && currentLine.length >= 2) {
    previewShapes.push(
      <Line
        key="current-pencil"
        points={currentLine}
        stroke={color}
        strokeWidth={strokeWidth}
        tension={0.4}
        lineCap="round"
        lineJoin="round"
      />
    )
  }
  if (tool === 'arrow' && drawing && arrowStart) {
    const pointerPos = stageRef.current?.getPointerPosition()
    if (pointerPos) {
      previewShapes.push(
        <Arrow
          key="current-arrow"
          points={[arrowStart.x, arrowStart.y, pointerPos.x, pointerPos.y]}
          stroke={color}
          strokeWidth={strokeWidth}
          fill={color}
          pointerLength={10}
          pointerWidth={10}
          opacity={0.85}
        />
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex h-9 shrink-0 items-center gap-0.5 border-b px-2"
      >
        <ToolButton
          active={tool === 'select'}
          onClick={() => setTool('select')}
          title="Select (inspect)"
          hint="V"
        >
          <MousePointer2 size={14} />
        </ToolButton>
        <ToolButton
          active={tool === 'pencil'}
          onClick={() => setTool('pencil')}
          title="Pencil (freehand)"
          hint="P"
        >
          <Pencil size={14} />
        </ToolButton>
        <ToolButton
          active={tool === 'arrow'}
          onClick={() => setTool('arrow')}
          title="Arrow"
          hint="A"
        >
          <ArrowUpRight size={14} />
        </ToolButton>
        <ToolButton
          active={tool === 'text'}
          onClick={() => setTool('text')}
          title="Text"
          hint="T"
        >
          <Type size={14} />
        </ToolButton>

        {/* Style only exists for tools that draw — in select mode it is dead
            weight, and the toolbar has to survive a 240px panel. */}
        {tool !== 'select' && (
          <>
            <Divider />
            <StylePopover
              color={color}
              strokeWidth={strokeWidth}
              onColor={setColor}
              onStrokeWidth={setStrokeWidth}
            />
          </>
        )}

        <div className="flex-1" />

        {hasWork && (
          <>
            <ToolButton onClick={undo} title="Undo (last shape)" hint="⌘Z">
              <Undo2 size={14} />
            </ToolButton>
            <ToolButton onClick={reset} title="Clear all">
              <Trash2 size={14} />
            </ToolButton>
            <Divider />
          </>
        )}
        <ToolButton onClick={exit} title="Exit annotation mode" hint="Esc">
          <X size={14} />
        </ToolButton>
      </div>

      {/* Content stays a flex child so its scroll container keeps working; the
          Stage overlays only this box. */}
      <div ref={contentRef} className="relative flex min-h-0 flex-1 flex-col">
        {children}

        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          listening={tool !== 'select'}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            // In select mode the stage must not swallow clicks: the element
            // inspector lives in the iframe below and needs the events.
            pointerEvents: tool === 'select' ? 'none' : 'auto',
            cursor:
              tool === 'select'
                ? 'default'
                : tool === 'text'
                  ? 'text'
                  : 'crosshair',
            touchAction: 'none',
          }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        >
          <Layer>
            {shapes.map((shape, i) => {
              if (shape.tool === 'pencil') {
                return (
                  <Line
                    key={i}
                    points={shape.points}
                    stroke={shape.color}
                    strokeWidth={shape.width}
                    tension={0.4}
                    lineCap="round"
                    lineJoin="round"
                  />
                )
              }
              if (shape.tool === 'arrow') {
                return (
                  <Arrow
                    key={i}
                    points={[shape.start.x, shape.start.y, shape.end.x, shape.end.y]}
                    stroke={shape.color}
                    strokeWidth={shape.width}
                    fill={shape.color}
                    pointerLength={10}
                    pointerWidth={10}
                  />
                )
              }
              return (
                <NoteCard
                  key={i}
                  note={shape}
                  index={noteIndexOf.get(i) ?? 1}
                  stageW={stageW}
                  stageH={stageH}
                />
              )
            })}
            {previewShapes}
          </Layer>
        </Stage>

        {/* Pinned element: offer a note on it, nothing more. The inspector
            already draws the bbox and names the element inside the iframe —
            repeating the selector here just gives you two labels to read. */}
        {tool === 'select' && pinned && !draft && (
          <button
            type="button"
            onClick={() => setDraft(pinned.anchor)}
            title={`Add a note on ${pinned.label}`}
            className="absolute z-30 flex items-center gap-1 rounded-md border border-main-view-fg/15 bg-main-view/95 px-1.5 py-0.5 text-[10px] font-medium text-main-view-fg/70 shadow-md backdrop-blur-sm hover:text-main-view-fg"
            style={{
              left: clamp(pinned.anchor.x - 52, 4, stageW - 60),
              top: clamp(pinned.anchor.y - 24, 4, stageH - 28),
            }}
          >
            <MessageSquarePlus size={11} />
            Note
          </button>
        )}

        {/* Same offer at the tip of a just-finished mark. */}
        {markHint && !draft && (
          <button
            type="button"
            onClick={() => setDraft(markHint)}
            title="Add a note here"
            aria-label="Add a note here"
            className="absolute z-30 flex size-6 items-center justify-center rounded-full border border-main-view-fg/15 bg-main-view/95 text-main-view-fg/70 shadow-md backdrop-blur-sm hover:text-main-view-fg"
            style={{
              left: clamp(markHint.x + 6, 4, stageW - 28),
              top: clamp(markHint.y + 6, 4, stageH - 28),
            }}
          >
            <MessageSquarePlus size={12} />
          </button>
        )}

        {draft && (
          <NoteInput
            pos={draft}
            color={color}
            stageW={stageW}
            stageH={stageH}
            onConfirm={commitNote}
            onCancel={() => setDraft(null)}
          />
        )}

        {/* Nothing drawn yet: no pill covering the preview, just the hint. */}
        {!hasWork && !draft && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 z-30 text-center text-[11px] text-main-view-fg/40">
            {tool === 'select'
              ? 'Click an element to inspect it'
              : 'Draw on the preview, then send it to the model'}
          </p>
        )}

        {hasWork && (
          <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center px-3">
            <div className="flex max-w-full flex-col items-center gap-1.5 rounded-xl border border-main-view-fg/15 bg-main-view/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
              {captureError && (
                <p className="max-w-[260px] px-1 text-center text-[10px] leading-snug text-main-view-fg/60">
                  Couldn&apos;t render the preview: {captureError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="xs"
                  disabled={sending}
                  onClick={() => void send(!!captureError)}
                  className="h-6 px-3 text-xs font-medium"
                >
                  {sending && <Loader2 size={12} className="animate-spin" />}
                  {captureError ? 'Send marks only' : 'Send to model'}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={exit}
                  className="h-6 px-2 text-xs text-main-view-fg/60 hover:text-main-view-fg"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-main-view-fg/15" />
}

/** Small icon button matching the cowork panel chrome. */
function ToolButton({
  active,
  onClick,
  title,
  hint,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded text-main-view-fg/60 transition-colors hover:bg-main-view-fg/10 hover:text-main-view-fg',
        active && 'bg-main-view-fg/10 text-main-view-fg'
      )}
      title={hint ? `${title} (${hint})` : title}
      aria-label={title}
    >
      {children}
    </button>
  )
}

/** Colour + stroke width behind one swatch, so the toolbar stays one row. */
function StylePopover({
  color,
  strokeWidth,
  onColor,
  onStrokeWidth,
}: {
  color: string
  strokeWidth: number
  onColor: (c: string) => void
  onStrokeWidth: (w: number) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Colour and stroke width"
          aria-label="Colour and stroke width"
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-main-view-fg/10"
        >
          <span
            className="rounded-full border border-black/10"
            style={{
              backgroundColor: color,
              width: strokeWidth + 8,
              height: strokeWidth + 8,
            }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              title={c}
              aria-label={`Annotation color ${c}`}
              className={cn(
                'size-5 rounded-full border transition-transform',
                color === c
                  ? 'scale-110 border-main-view-fg/60 ring-2 ring-main-view-fg/20'
                  : 'border-black/10 hover:scale-110'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 border-t border-main-view-fg/10 pt-2">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onStrokeWidth(w)}
              title={`${w}px`}
              aria-label={`Stroke width ${w}px`}
              className={cn(
                'flex h-6 flex-1 items-center justify-center rounded transition-colors',
                strokeWidth === w
                  ? 'bg-main-view-fg/15 text-main-view-fg'
                  : 'text-main-view-fg/50 hover:bg-main-view-fg/10'
              )}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: w + 2, height: w + 2 }}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * A committed note: numbered card with a leader line to its anchor dot.
 *
 * Always light-on-white regardless of app theme — this is baked into the PNG
 * the model reads, so legibility beats matching the surrounding chrome.
 */
function NoteCard({
  note,
  index,
  stageW,
  stageH,
}: {
  note: NoteShape
  index: number
  stageW: number
  stageH: number
}) {
  const h = noteHeight(note.text)
  const x = clamp(note.pos.x + 14, 4, stageW - NOTE_W - 4)
  const y = clamp(note.pos.y + 14, 4, stageH - h - 4)
  return (
    <Group listening={false}>
      <Line
        points={[note.pos.x, note.pos.y, x + 12, y]}
        stroke={note.color}
        strokeWidth={1.5}
        opacity={0.7}
      />
      <Rect
        x={x}
        y={y}
        width={NOTE_W}
        height={h}
        fill="#ffffff"
        stroke={note.color}
        strokeWidth={1.5}
        cornerRadius={7}
        shadowColor="#000000"
        shadowOpacity={0.18}
        shadowBlur={6}
        shadowOffsetY={1}
      />
      <Circle x={x + 15} y={y + NOTE_PAD + 6} radius={7.5} fill={note.color} />
      <Text
        x={x + 7}
        y={y + NOTE_PAD + 2}
        width={16}
        align="center"
        text={String(index)}
        fontSize={10}
        fontStyle="bold"
        fill="#ffffff"
        fontFamily={NOTE_FONT}
      />
      <Text
        x={x + 28}
        y={y + NOTE_PAD}
        width={NOTE_TEXT_W}
        text={note.text}
        fontSize={NOTE_FONT_SIZE}
        lineHeight={NOTE_LINE_HEIGHT}
        fill="#0f172a"
        fontFamily={NOTE_FONT}
        wrap="word"
      />
      <Circle
        x={note.pos.x}
        y={note.pos.y}
        radius={4}
        fill={note.color}
        stroke="#ffffff"
        strokeWidth={1.5}
      />
    </Group>
  )
}

/** Inline note input, anchored at the element or mark it describes. */
function NoteInput({
  pos,
  color,
  stageW,
  stageH,
  onConfirm,
  onCancel,
}: {
  pos: Point
  color: string
  stageW: number
  stageH: number
  onConfirm: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="absolute z-40"
      style={{
        left: clamp(pos.x + 14, 4, stageW - 212),
        top: clamp(pos.y + 14, 4, stageH - 92),
      }}
    >
      <div
        className="w-[208px] overflow-hidden rounded-lg border bg-main-view shadow-xl"
        style={{ borderColor: color }}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              onConfirm(value)
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              onCancel()
            }
          }}
          placeholder="Add note…"
          rows={2}
          className="w-full resize-none border-0 bg-transparent px-2.5 py-2 text-[13px] leading-snug text-main-view-fg outline-none placeholder:text-main-view-fg/35"
        />
        <div className="flex items-center justify-between border-t border-main-view-fg/10 px-1.5 py-1">
          <span className="pl-1 text-[10px] text-main-view-fg/40">
            Enter to save
          </span>
          <div className="flex gap-0.5">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-1.5 py-0.5 text-[10px] text-main-view-fg/60 hover:bg-main-view-fg/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(value)}
              className="rounded bg-main-view-fg/10 px-1.5 py-0.5 text-[10px] text-main-view-fg/80 hover:bg-main-view-fg/20"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
