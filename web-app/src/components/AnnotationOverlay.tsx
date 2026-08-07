/**
 * Annotation overlay for artifact previews.
 *
 * When `active`, renders an inline toolbar (matching the cowork panel chrome)
 * above the preview content and a transparent Konva Stage over it, supporting
 * element inspection (select), freehand pencil, arrow, and text tools. Exports
 * to PNG data URL via `stage.toDataURL()` for sending as model context.
 *
 * The select tool is the default: it makes the Stage pointer-transparent so
 * clicks reach the preview iframe, where the injected element inspector (see
 * `lib/previewInspector.ts`) draws the hover outline / pinned bbox.
 *
 * Inline notes: selecting an element (or finishing a stroke) pops a small
 * chat-style input right at that spot; the committed text is rendered as a
 * comment pin (text + anchor dot) in the annotation layer and exported with
 * the screenshot, so the model sees the note next to the element it refers to.
 * The inspector reports the pinned bbox to the parent via postMessage.
 *
 * Layout note: the toolbar is a sibling of the content wrapper (which stays a
 * flex child of the panel), so the preview's scroll container keeps its
 * `flex-1 overflow-auto` behavior while annotation mode is on — the Stage only
 * overlays the visible content box.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  MousePointer2,
  Pencil,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import { Stage, Layer, Line, Arrow, Text, Circle } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Button } from '@/components/ui/button'
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

interface TextShape {
  tool: 'text'
  pos: Point
  text: string
  color: string
  fontSize: number
}

/** Small anchor dot drawn under a committed note so it reads as a comment pin. */
interface DotShape {
  tool: 'dot'
  pos: Point
  color: string
}

type AnnotationShape = PencilStroke | ArrowShape | TextShape | DotShape

interface AnnotationOverlayProps {
  /** Whether annotation mode is active. */
  active: boolean
  /** Called with the PNG data URL when the user clicks "Send". */
  onSend: (dataUrl: string) => void
  /** Called when the user cancels annotation mode. */
  onCancel: () => void
  children: React.ReactNode
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7']
const STROKE_WIDTHS = [2, 3, 5]
const DEFAULT_COLOR = '#ef4444'
const TEXT_FONT_SIZE = 16

export function AnnotationOverlay({
  active,
  onSend,
  onCancel,
  children,
}: AnnotationOverlayProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  /** Last element-pin anchor that opened a note, to dedupe re-clicks. */
  const lastPinRef = useRef<Point | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [shapes, setShapes] = useState<AnnotationShape[]>([])
  const [drawing, setDrawing] = useState(false)
  const [currentLine, setCurrentLine] = useState<number[]>([])
  const [arrowStart, setArrowStart] = useState<Point | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [textEdit, setTextEdit] = useState<{
    pos: Point
    shapeIndex: number
  } | null>(null)

  // Drop the pending (empty) note placeholder shape alongside its input.
  const discardPendingNote = useCallback(() => {
    if (textEdit) {
      setShapes((prev) => prev.filter((_, i) => i !== textEdit.shapeIndex))
      setTextEdit(null)
    }
  }, [textEdit])

  // Track the visible content box while active; the Stage overlays exactly
  // this area (toolbar excluded).
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

  // Esc exits annotation mode (or closes an open note first).
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (textEdit) discardPendingNote()
      else onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, textEdit, onCancel, discardPendingNote])

  // An element pin inside the preview iframe anchors the inline note box at
  // the selected element (select tool -> inspector posts the bbox rect).
  useEffect(() => {
    if (!active) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | { source?: string; type?: string; rect?: { x: number; y: number; width: number; height: number } }
        | null
      if (!data || data.source !== 'jan-preview-inspector') return
      if (data.type === 'clear') {
        lastPinRef.current = null
        discardPendingNote()
        return
      }
      if (data.type !== 'pin' || !data.rect) return

      // Only the iframe this overlay wraps may drive the note position.
      const iframe = contentRef.current?.querySelector('iframe')
      if (iframe && e.source !== iframe.contentWindow) return

      // Convert iframe-viewport coords to stage coords (accounts for the
      // iframe's offset inside the scrollable content box).
      const box = contentRef.current?.getBoundingClientRect()
      const frameRect = iframe?.getBoundingClientRect()
      let x = data.rect.x
      let y = data.rect.y
      if (box && frameRect) {
        x = frameRect.left - box.left + data.rect.x
        y = frameRect.top - box.top + data.rect.y
      }
      // Anchor the note at the top-right of the bbox, clamped to the stage.
      const anchor: Point = {
        x: Math.min(x + data.rect.width, Math.max(0, dimensions.width - 140)),
        y: Math.min(y, Math.max(0, dimensions.height - 48)),
      }

      // A fresh element pin opens the note box; re-clicking the same element
      // or an already-open note keeps the current state.
      if (textEdit) return
      const last = lastPinRef.current
      if (last && Math.abs(last.x - anchor.x) < 2 && Math.abs(last.y - anchor.y) < 2) return
      lastPinRef.current = anchor

      const idx = shapes.length
      setShapes((prev) => [
        ...prev,
        { tool: 'text', pos: anchor, text: '', color, fontSize: TEXT_FONT_SIZE },
      ])
      setTextEdit({ pos: anchor, shapeIndex: idx })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [active, textEdit, discardPendingNote, dimensions, color, shapes.length])

  // Leaving annotation mode drops any pending note input.
  useEffect(() => {
    if (!active && textEdit) discardPendingNote()
  }, [active, textEdit, discardPendingNote])

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

      if (tool === 'pencil') {
        setDrawing(true)
        setCurrentLine([pos.x, pos.y])
      } else if (tool === 'arrow') {
        setDrawing(true)
        setArrowStart(pos)
      } else if (tool === 'text') {
        const idx = shapes.length
        setShapes((prev) => [
          ...prev,
          { tool: 'text', pos, text: '', color, fontSize: TEXT_FONT_SIZE },
        ])
        setTextEdit({ pos, shapeIndex: idx })
      }
    },
    [active, tool, color, shapes, getPointerPos]
  )

  const handlePointerMove = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!drawing || !active) return
      const pos = getPointerPos(e)
      if (tool === 'pencil') {
        setCurrentLine((prev) => {
          // Skip if too close to last point (reduces jaggedness)
          if (prev.length >= 2) {
            const lastX = prev[prev.length - 2]
            const lastY = prev[prev.length - 1]
            const dx = pos.x - lastX
            const dy = pos.y - lastY
            if (dx * dx + dy * dy < 4) return prev // min 2px distance
          }
          return [...prev, pos.x, pos.y]
        })
      }
    },
    [drawing, active, tool, getPointerPos]
  )

  const handlePointerUp = useCallback(() => {
    if (!drawing) return

    // A note box follows each completed stroke, anchored at its tip. The
    // placeholder is appended after the stroke, so its index is the pre-stroke
    // count + 1 (both updaters run in order within this event).
    let noteAnchor: Point | null = null
    if (tool === 'pencil' && currentLine.length >= 2) {
      const pts = currentLine
      noteAnchor = { x: pts[pts.length - 2], y: pts[pts.length - 1] }
      setShapes((prev) => [
        ...prev,
        { tool: 'pencil', points: pts, color, width: strokeWidth },
      ])
      setCurrentLine([])
    } else if (tool === 'arrow' && arrowStart) {
      const stage = stageRef.current
      const end = stage?.getPointerPosition() ?? arrowStart
      noteAnchor = end
      setShapes((prev) => [
        ...prev,
        { tool: 'arrow', start: arrowStart, end, color, width: strokeWidth },
      ])
      setArrowStart(null)
    }

    setDrawing(false)

    if (noteAnchor && !textEdit) {
      const idx = shapes.length + 1
      setShapes((prev) => [
        ...prev,
        { tool: 'text', pos: noteAnchor, text: '', color, fontSize: TEXT_FONT_SIZE },
      ])
      setTextEdit({ pos: noteAnchor, shapeIndex: idx })
    }
  }, [drawing, tool, currentLine, arrowStart, color, strokeWidth, textEdit, shapes.length])

  const handleTextConfirm = useCallback(
    (text: string) => {
      if (!textEdit) return
      if (text.trim()) {
        // Reuse the color the placeholder was created with so the note matches
        // its anchor even if the palette changed mid-typing.
        const ph = shapes[textEdit.shapeIndex]
        const fill =
          ph && ph.tool === 'text' ? ph.color : color
        setShapes((prev) => {
          const copy = [...prev]
          copy[textEdit.shapeIndex] = {
            tool: 'text',
            pos: textEdit.pos,
            text: text.trim(),
            color: fill,
            fontSize: TEXT_FONT_SIZE,
          }
          return [...copy, { tool: 'dot', pos: textEdit.pos, color: fill }]
        })
      } else {
        // Empty text - remove the placeholder shape.
        setShapes((prev) => prev.filter((_, i) => i !== textEdit.shapeIndex))
      }
      setTextEdit(null)
    },
    [textEdit, shapes, color]
  )

  const undo = useCallback(() => {
    setShapes((prev) => prev.slice(0, -1))
  }, [])

  const clearAll = useCallback(() => {
    setShapes([])
    setCurrentLine([])
    setArrowStart(null)
    lastPinRef.current = null
  }, [])

  const exit = useCallback(() => {
    clearAll()
    onCancel()
  }, [clearAll, onCancel])

  const handleSend = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const dataUrl = stage.toDataURL({
      mimeType: 'image/png',
      pixelRatio: window.devicePixelRatio || 1,
    })
    onSend(dataUrl)
    setShapes([])
    lastPinRef.current = null
    onCancel()
  }, [onSend, onCancel])

  if (!active) {
    return <>{children}</>
  }

  // Live previews of in-progress shapes.
  const previewShapes: React.ReactNode[] = []

  // Compute the bounding box of the current pencil stroke for the dashed bbox feedback.
  let strokeBbox: { x: number; y: number; width: number; height: number } | null = null
  if (tool === 'pencil' && drawing && currentLine.length >= 2) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < currentLine.length; i += 2) {
      const px = currentLine[i], py = currentLine[i + 1]
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    strokeBbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    previewShapes.push(
      <Line
        key="current-pencil"
        points={currentLine}
        stroke={color}
        strokeWidth={strokeWidth}
        tension={0.7}
        lineCap="round"
        lineJoin="round"
      />
    )
  }
  if (tool === 'arrow' && drawing && arrowStart) {
    const pointerPos = stageRef.current?.getPointerPosition()
    if (pointerPos) {
      // Arrow bbox: from start to current pointer position.
      strokeBbox = {
        x: Math.min(arrowStart.x, pointerPos.x),
        y: Math.min(arrowStart.y, pointerPos.y),
        width: Math.abs(pointerPos.x - arrowStart.x),
        height: Math.abs(pointerPos.y - arrowStart.y),
      }
      previewShapes.push(
        <Arrow
          key="current-arrow"
          points={[arrowStart.x, arrowStart.y, pointerPos.x, pointerPos.y]}
          stroke={color}
          strokeWidth={strokeWidth}
          fill={color}
          pointerLength={10}
          pointerWidth={10}
        />
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Inline toolbar: two rows for narrow panels.
          Row 1: tools + undo/clear actions
          Row 2: color palette + stroke width */}
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex shrink-0 flex-col border-b"
      >
        {/* Row 1: tools and actions */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          <ToolButton
            active={tool === 'select'}
            onClick={() => setTool('select')}
            title="Select (inspect)"
          >
            <MousePointer2 size={14} />
          </ToolButton>
          <ToolButton
            active={tool === 'pencil'}
            onClick={() => setTool('pencil')}
            title="Pencil (freehand)"
          >
            <Pencil size={14} />
          </ToolButton>
          <ToolButton
            active={tool === 'arrow'}
            onClick={() => setTool('arrow')}
            title="Arrow"
          >
            <ArrowUpRight size={14} />
          </ToolButton>
          <ToolButton
            active={tool === 'text'}
            onClick={() => setTool('text')}
            title="Text"
          >
            <Type size={14} />
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-main-view-fg/15" />

          <ToolButton onClick={undo} title="Undo (last shape)">
            <Undo2 size={14} />
          </ToolButton>
          <ToolButton onClick={clearAll} title="Clear all">
            <Trash2 size={14} />
          </ToolButton>
        </div>

        {/* Row 2: colors and stroke width */}
        <div className="flex items-center gap-1.5 border-t border-main-view-fg/10 px-2 py-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              title={c}
              aria-label={`Annotation color ${c}`}
              className={cn(
                'size-4 rounded-full border transition-all',
                color === c
                  ? 'scale-110 border-main-view-fg/60 ring-2 ring-main-view-fg/20'
                  : 'border-main-view-fg/20 hover:scale-110 hover:border-main-view-fg/40'
              )}
              style={{ backgroundColor: c }}
            />
          ))}

          <span className="mx-1 h-4 w-px bg-main-view-fg/15" />

          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setStrokeWidth(w)}
              title={`${w}px`}
              aria-label={`Stroke width ${w}px`}
              className={cn(
                'flex size-5 items-center justify-center rounded transition-colors',
                strokeWidth === w
                  ? 'bg-main-view-fg/15 text-main-view-fg'
                  : 'text-main-view-fg/50 hover:bg-main-view-fg/10 hover:text-main-view-fg'
              )}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: Math.max(w, 2), height: Math.max(w, 2) }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Content stays a flex child so its scroll container keeps working; the
          Stage overlays only this box. */}
      <div ref={contentRef} className="relative flex min-h-0 flex-1 flex-col">
        {children}

        <Stage
          ref={stageRef}
          width={dimensions.width || 400}
          height={dimensions.height || 300}
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
                    tension={0.7}
                    lineCap="round"
                    lineJoin="round"
                  />
                )
              }
              if (shape.tool === 'arrow') {
                return (
                  <Arrow
                    key={i}
                    points={[
                      shape.start.x,
                      shape.start.y,
                      shape.end.x,
                      shape.end.y,
                    ]}
                    stroke={shape.color}
                    strokeWidth={shape.width}
                    fill={shape.color}
                    pointerLength={10}
                    pointerWidth={10}
                  />
                )
              }
              if (shape.tool === 'text') {
                return (
                  <Text
                    key={i}
                    x={shape.pos.x}
                    y={shape.pos.y}
                    text={shape.text}
                    fontSize={shape.fontSize}
                    fill={shape.color}
                    fontFamily="system-ui, sans-serif"
                    visible={!!shape.text}
                  />
                )
              }
              if (shape.tool === 'dot') {
                return (
                  <Circle
                    key={i}
                    x={shape.pos.x}
                    y={shape.pos.y}
                    radius={3}
                    fill={shape.color}
                  />
                )
              }
              return null
            })}
            {/* Dashed bbox feedback while drawing */}
            {strokeBbox && (
              <Line
                key="stroke-bbox"
                points={[
                  strokeBbox.x, strokeBbox.y,
                  strokeBbox.x + strokeBbox.width, strokeBbox.y,
                  strokeBbox.x + strokeBbox.width, strokeBbox.y + strokeBbox.height,
                  strokeBbox.x, strokeBbox.y + strokeBbox.height,
                  strokeBbox.x, strokeBbox.y,
                ]}
                stroke={color}
                strokeWidth={1}
                dash={[6, 4]}
                closed
                listening={false}
              />
            )}
          </Layer>
        </Stage>

        {textEdit && (
          <TextInputOverlay
            pos={textEdit.pos}
            color={color}
            onConfirm={handleTextConfirm}
          />
        )}

        {/* Action pill: floats at the bottom of the preview, the natural spot
            after drawing. Solid bg so it stays readable over any content. */}
        <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-main-view-fg/15 bg-main-view/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
            <Button
              variant="default"
              size="xs"
              onClick={handleSend}
              className="h-6 px-3 text-xs font-medium"
            >
              Send to model
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
    </div>
  )
}

/** Small icon button matching the cowork panel chrome. */
function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex size-6 items-center justify-center rounded text-main-view-fg/60 hover:bg-main-view-fg/10 hover:text-main-view-fg',
        active && 'bg-main-view-fg/10 text-main-view-fg'
      )}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  )
}

/** Inline note input: a small chat-style card anchored at the element/stroke. */
function TextInputOverlay({
  pos,
  color,
  onConfirm,
}: {
  pos: Point
  color: string
  onConfirm: (text: string) => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        left: Math.max(8, pos.x - 60),
        top: pos.y + 12,
        zIndex: 30,
      }}
    >
      <div
        className="rounded-lg border bg-main-view shadow-lg"
        style={{ borderColor: color }}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onConfirm(value)
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              onConfirm('')
            }
          }}
          onBlur={() => onConfirm(value)}
          placeholder="Add note…"
          rows={2}
          className="min-w-[140px] max-w-[220px] resize-none rounded-lg border-0 bg-transparent px-2.5 py-2 text-sm outline-none"
          style={{
            color,
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
            lineHeight: 1.4,
          }}
        />
        <div className="flex items-center justify-between border-t border-main-view-fg/10 px-2 py-1">
          <span className="text-[10px] text-main-view-fg/40">Enter to save</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onConfirm('')}
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
