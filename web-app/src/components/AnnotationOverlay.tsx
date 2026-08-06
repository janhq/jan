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
import { Stage, Layer, Line, Arrow, Text } from 'react-konva'
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

type AnnotationShape = PencilStroke | ArrowShape | TextShape

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

  // Esc exits annotation mode (or closes an open text editor first).
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (textEdit) setTextEdit(null)
      else onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, textEdit, onCancel])

  const getPointerPos = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>): Point => {
      const stage = e.target.getStage()
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
        setCurrentLine((prev) => [...prev, pos.x, pos.y])
      }
    },
    [drawing, active, tool, getPointerPos]
  )

  const handlePointerUp = useCallback(() => {
    if (!drawing) return

    if (tool === 'pencil' && currentLine.length >= 4) {
      setShapes((prev) => [
        ...prev,
        { tool: 'pencil', points: currentLine, color, width: strokeWidth },
      ])
      setCurrentLine([])
    } else if (tool === 'arrow' && arrowStart) {
      const stage = stageRef.current
      const end = stage?.getPointerPosition() ?? arrowStart
      setShapes((prev) => [
        ...prev,
        { tool: 'arrow', start: arrowStart, end, color, width: strokeWidth },
      ])
      setArrowStart(null)
    }

    setDrawing(false)
  }, [drawing, tool, currentLine, arrowStart, color, strokeWidth])

  const handleTextConfirm = useCallback(
    (text: string) => {
      if (!textEdit) return
      if (text.trim()) {
        setShapes((prev) => {
          const copy = [...prev]
          copy[textEdit.shapeIndex] = {
            ...copy[textEdit.shapeIndex],
            text: text.trim(),
          } as TextShape
          return copy
        })
      } else {
        // Empty text - remove the placeholder shape.
        setShapes((prev) => prev.filter((_, i) => i !== textEdit.shapeIndex))
      }
      setTextEdit(null)
    },
    [textEdit]
  )

  const undo = useCallback(() => {
    setShapes((prev) => prev.slice(0, -1))
  }, [])

  const clearAll = useCallback(() => {
    setShapes([])
    setCurrentLine([])
    setArrowStart(null)
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
    onCancel()
  }, [onSend, onCancel])

  if (!active) {
    return <>{children}</>
  }

  // Live previews of in-progress shapes.
  const previewShapes: React.ReactNode[] = []
  if (tool === 'pencil' && drawing && currentLine.length >= 4) {
    previewShapes.push(
      <Line
        key="current-pencil"
        points={currentLine}
        stroke={color}
        strokeWidth={strokeWidth}
        tension={0.5}
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
        />
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Inline toolbar: sibling of the content box, styled like the panel
          chrome (main-view fg tokens, subtle dividers, lucide icons). Only
          tools live here so the row fits the narrow panel width; the
          Send/Cancel actions float at the bottom of the preview. */}
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
      >
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

        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            title={c}
            aria-label={`Annotation color ${c}`}
            className={cn(
              'size-3 rounded-full border transition-transform',
              color === c
                ? 'scale-110 border-main-view-fg/60'
                : 'border-main-view-fg/20 hover:scale-110'
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
              'flex size-3.5 items-center justify-center rounded text-main-view-fg/60 hover:text-main-view-fg',
              strokeWidth === w && 'bg-main-view-fg/10 text-main-view-fg'
            )}
          >
            <span
              className="rounded-full bg-current"
              style={{ width: w + 1, height: w + 1 }}
            />
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-main-view-fg/15" />

        <ToolButton onClick={undo} title="Undo (last shape)">
          <Undo2 size={14} />
        </ToolButton>
        <ToolButton onClick={clearAll} title="Clear all">
          <Trash2 size={14} />
        </ToolButton>
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
                    tension={0.5}
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
              return null
            })}
            {previewShapes}
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
        <div className="absolute inset-x-0 bottom-2 z-30 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border bg-main-view px-1.5 py-1 shadow-md">
            <Button variant="default" size="xs" onClick={handleSend} className="shrink-0">
              Send to model
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={exit}
              className="shrink-0 text-main-view-fg/60"
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

/** Floating textarea for text annotation input. */
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
        left: pos.x,
        top: pos.y,
        zIndex: 30,
      }}
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
            // Stop it reaching the window handler, which would also exit mode.
            e.stopPropagation()
            onConfirm('')
          }
        }}
        onBlur={() => onConfirm(value)}
        className="min-w-[120px] resize-none rounded-md border bg-background px-2 py-1 text-sm shadow-sm outline-none"
        style={{
          color,
          fontSize: TEXT_FONT_SIZE,
          fontFamily: 'system-ui, sans-serif',
          borderColor: color,
          lineHeight: 1.3,
        }}
        rows={1}
        placeholder="Type here..."
      />
    </div>
  )
}
