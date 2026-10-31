/**
 * Fuzzy file/folder picker popover triggered by typing `@` in the chat input.
 *
 * Scoped to the session's working directory. Supports keyboard navigation
 * (arrows, tab to complete, enter to select, esc to dismiss).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFloatingLayer } from '@/components/ui/overlay-layer'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { Folder, File, FileCode, FileText, ImageIcon, FileJson, FileType } from 'lucide-react'
import type { FilePickerEntry } from '@/types/path-reference'

// ─── File-type icon helper ───────────────────────────────────────────────────
const extIconMap: Record<string, typeof FileCode> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  rs: FileCode,
  py: FileCode,
  go: FileCode,
  java: FileCode,
  cpp: FileCode,
  c: FileCode,
  h: FileCode,
  json: FileJson,
  yaml: FileJson,
  yml: FileJson,
  toml: FileJson,
  md: FileText,
  txt: FileText,
  pdf: FileText,
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  svg: ImageIcon,
  css: FileType,
  scss: FileType,
  html: FileType,
  xml: FileType,
}

function FileIcon({ entry }: { entry: FilePickerEntry }) {
  if (entry.kind === 'directory') return <Folder className="size-4 shrink-0 text-amber-500" />
  const ext = entry.extension?.toLowerCase() ?? ''
  const Icon = extIconMap[ext]
  if (Icon) return <Icon className="size-4 shrink-0 text-blue-500" />
  return <File className="size-4 shrink-0 text-muted-foreground" />
}

// ─── Props ───────────────────────────────────────────────────────────────────
type FilePickerPopoverProps = {
  /** List of entries to show */
  entries: FilePickerEntry[]
  /** Search query (the text after `@`) */
  query: string
  /** Whether the picker is visible */
  open: boolean
  /** Position offset relative to the textarea */
  position: { top: number; left: number } | null
  /** Called when a path is selected (tab or enter) */
  onSelect: (entry: FilePickerEntry) => void
  /** Called to dismiss */
  onClose: () => void
  /** Ref for the textarea to position relative to */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export function FilePickerPopover({
  entries,
  query,
  open,
  position,
  onSelect,
  onClose,
  textareaRef,
}: FilePickerPopoverProps) {
  const floatingLayer = useFloatingLayer()
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Reset selection when entries change
  useEffect(() => {
    setActiveIndex(0)
  }, [entries.length])

  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })

  // The composer supplies offsets from the textarea's bottom edge. Convert to
  // viewport coordinates before portalling so its z-20/overflow cannot trap us.
  useLayoutEffect(() => {
    if (!open || !position || !textareaRef.current) return
    const textarea = textareaRef.current
    const update = () => {
      const rect = textarea.getBoundingClientRect()
      const width = Math.min(400, Math.max(0, window.innerWidth - 16))
      const height = popoverRef.current?.getBoundingClientRect().height ?? 300
      setPopoverStyle({
        width,
        left: Math.max(8, Math.min(rect.left + position.left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(rect.bottom + position.top, window.innerHeight - height - 8)),
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(textarea)
    if (popoverRef.current) observer.observe(popoverRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, position, textareaRef, entries.length])

  // Scroll active item into view
  useEffect(() => {
    const el = itemRefs.current.get(activeIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // Keyboard handling is done in ChatInput, but we expose arrow navigation here
  // We'll handle it through imperative methods
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex((prev) => Math.min(prev + 1, entries.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
        case 'Tab':
          if (entries.length > 0 && entries[activeIndex]) {
            e.preventDefault()
            e.stopPropagation()
            onSelect(entries[activeIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
      }
    },
    [open, entries, activeIndex, onSelect, onClose]
  )

  if (!open || entries.length === 0) return null

  return createPortal(
    <div
      ref={popoverRef}
      className={cn("fixed w-[400px] max-h-[300px] overflow-y-auto rounded-xl border border-border bg-popover shadow-popover p-1", floatingLayer)}
      style={popoverStyle}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.preventDefault()}
      role="listbox"
      tabIndex={-1}
    >
      <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border/50 mb-1">
        {entries.length === 1
          ? '1 result'
          : `${entries.length} results`}
        {query && (
          <span>
            {' '}for <span className="font-mono font-medium text-foreground/70">@{query}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] opacity-60">
          ↑↓ navigate · Tab/Enter select · Esc dismiss
        </span>
      </div>
      <div ref={listRef}>
        {entries.map((entry, idx) => (
          <div
            key={entry.path}
            ref={(el) => {
              if (el) itemRefs.current.set(idx, el)
              else itemRefs.current.delete(idx)
            }}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors',
              idx === activeIndex
                ? 'bg-primary/10 text-primary-foreground'
                : 'hover:bg-accent'
            )}
            onClick={() => onSelect(entry)}
            onMouseEnter={() => setActiveIndex(idx)}
            role="option"
            aria-selected={idx === activeIndex}
          >
            <FileIcon entry={entry} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">{entry.name}</span>
                <span className="text-[10px] text-muted-foreground/50 uppercase shrink-0">
                  {entry.kind === 'directory' ? 'folder' : entry.extension}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground/60 truncate">
                {entry.path}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}
