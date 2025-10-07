import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { IconCheck } from '@tabler/icons-react'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Simple calendar date range picker (no external deps).
function CalendarPicker({
  startIso,
  endIso,
  onChange,
}: {
  startIso: string
  endIso: string
  onChange: (start: string, end: string) => void
}) {
  const toDate = (iso: string) => (iso ? new Date(iso + 'T00:00:00') : null)
  const startDate = toDate(startIso)
  const endDate = toDate(endIso)

  const today = new Date()
  // Always start calendar view from today for better UX (even if startIso represents epoch)
  const [viewYear, setViewYear] = useState<number>(today.getFullYear())
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth())

  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const startWeekDay = firstOfMonth.getDay() // 0..6 (Sun..Sat)

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: (Date | null)[] = []
  for (let i = 0; i < startWeekDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d))

  const isoFor = (d: Date) => `${d.getFullYear().toString().padStart(4, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`

  const isBetween = (d: Date) => {
    if (!d) return false
    if (!startDate && !endDate) return false
    const t = d.getTime()
    const s = startDate ? startDate.getTime() : 0
    const e = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999).getTime() : Infinity
    return t >= s && t <= e
  }

  const handleDayClick = (d: Date | null) => {
    if (!d) return
    const iso = isoFor(d)
    // selection logic: if neither set -> set start; if start set and end not set -> if clicked >= start -> set end else set start; if both set -> start=clicked, end=''
    if (!startIso) return onChange(iso, '')
    if (startIso && !endIso) {
      const s = new Date(startIso + 'T00:00:00').getTime()
      const t = d.getTime()
      if (t >= s) return onChange(startIso, iso)
      return onChange(iso, '')
    }
    // both set -> start = clicked, clear end
    return onChange(iso, '')
  }

  // Right-click sets the end date directly (context menu). We prevent default context menu.
  const handleDayRightClick = (d: Date | null) => {
    if (!d) return
    const iso = isoFor(d)
    // Keep existing startIso, set end to clicked date
    return onChange(startIso || '', iso)
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          className="px-2 py-1 text-sm rounded hover:bg-main-view-fg/5"
          onClick={() => {
            const prev = new Date(viewYear, viewMonth - 1, 1)
            setViewYear(prev.getFullYear())
            setViewMonth(prev.getMonth())
          }}
        >
          ‹
        </button>
        <div className="text-sm font-medium">{firstOfMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button
          type="button"
          className="px-2 py-1 text-sm rounded hover:bg-main-view-fg/5"
          onClick={() => {
            const next = new Date(viewYear, viewMonth + 1, 1)
            setViewYear(next.getFullYear())
            setViewMonth(next.getMonth())
          }}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs text-center mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d) => (
          <div key={d} className="text-main-view-fg/60">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={idx} />
          const iso = isoFor(cell)
          const selectedStart = startIso === iso
          const selectedEnd = endIso === iso
          const between = isBetween(cell)
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleDayClick(cell)}
              onContextMenu={(e) => {
                e.preventDefault()
                handleDayRightClick(cell)
              }}
              className={`px-2 py-1 rounded text-sm ${selectedStart || selectedEnd ? 'bg-main-view-fg/10 font-semibold' : between ? 'bg-main-view-fg/5' : 'hover:bg-main-view-fg/3'}`}
            >
              {cell.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])

  const threadsMap = useThreads((s) => s.threads)

  const allThreads = useMemo(() => Object.values(threadsMap), [threadsMap])

  const { folders } = useThreadManagement()
  // date range state: start defaults to Timestamp(0), end defaults to infinite (empty)
  const [startDateIso, setStartDateIso] = useState<string>('1970-01-01')
  const [endDateIso, setEndDateIso] = useState<string>('')

  const results = useMemo(() => {
    // compute date bounds in ms
    const startTs = startDateIso ? new Date(startDateIso + 'T00:00:00').getTime() : 0
    const endTs = endDateIso ? new Date(endDateIso + 'T23:59:59.999').getTime() : Infinity
    // First filter by selected projects (if any)
    let source = allThreads
    if (selectedProjects.length > 0) {
      const setIds = new Set(selectedProjects)
      source = allThreads.filter((th: any) => setIds.has(th.metadata?.project?.id))
    }

    if (!query && startTs === 0 && endTs === Infinity) return source
    const q = query.toLowerCase()
    return source.filter((t: any) => {
      // compute latest timestamp for the thread (ms)
      const dateCandidates: any[] = []
      if (t.last_message?.created_at) dateCandidates.push(t.last_message.created_at)
      if (t.messages && Array.isArray(t.messages)) {
        for (const m of t.messages) {
          if (m?.created_at) dateCandidates.push(m.created_at)
          if (m?.timestamp) dateCandidates.push(m.timestamp)
        }
      }
      dateCandidates.push(t.updated_at, t.created_at, t.metadata?.updated_at, t.metadata?.created_at)

      let latestTime = NaN
      for (const cand of dateCandidates) {
        if (!cand) continue
        let tt = NaN
        if (typeof cand === 'number') tt = cand
        else if (typeof cand === 'string') {
          if (/^\d+$/.test(cand)) tt = Number(cand)
          else {
            const d = new Date(cand)
            if (!isNaN(d.getTime())) tt = d.getTime()
          }
        }
        if (isNaN(tt)) continue
        if (tt < 1e12) tt = tt * 1000
        if (isNaN(latestTime) || tt > latestTime) latestTime = tt
      }
      // if no timestamp, treat as 0
      if (isNaN(latestTime)) latestTime = 0
      // filter by date range
      if (latestTime < startTs || latestTime > endTs) return false
      const title = (t.title || t.name || t.metadata?.title || '').toString().toLowerCase()
      if (title.includes(q)) return true

      // build a content string from common locations (messages, preview, content fields)
      let content = ''
      if (t.preview) content += ' ' + String(t.preview)
      if (t.content) content += ' ' + String(t.content)
      if (t.messages && Array.isArray(t.messages)) {
        content += ' ' + t.messages.map((m: any) => String(m.content || m.text || '')).join(' ')
      }
      // metadata fields
      if (t.metadata) {
        try {
          content += ' ' + JSON.stringify(t.metadata)
        } catch {}
      }

      return content.toLowerCase().includes(q)
    })
  }, [allThreads, query, selectedProjects, startDateIso, endDateIso])

  // Format YYYY-MM-DD ISO string into a locale-friendly date (dd/mm/yyyy where appropriate)
  const formatIso = (iso: string) => {
    if (!iso) return ''
    try {
      const d = new Date(iso + 'T00:00:00')
      return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
      return iso
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('common:search')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 overflow-x-hidden">
          <div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common:search')}
              autoFocus
            />
          </div>

          {/* Project filter dropdown placed after the input */}
          {folders && folders.length > 0 && (
            <div className="flex items-center gap-2">
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="px-2 py-1 text-sm rounded-md border border-main-view-fg/10 hover:bg-main-view-fg/3"
                    >
                      {selectedProjects.length === 0
                        ? t('projects.filterByProject')
                        : `${selectedProjects.length} ${t('projects.selected')}`}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" className="w-56 max-h-60 overflow-y-auto z-[95]">
                    {folders.map((f: any) => {
                      const selected = selectedProjects.includes(f.id)
                      return (
                        <DropdownMenuItem
                          key={f.id}
                          onSelect={(e) => {
                            e.preventDefault()
                            setSelectedProjects((prev) => {
                              if (prev.includes(f.id)) return prev.filter((id) => id !== f.id)
                              return [...prev, f.id]
                            })
                          }}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="truncate max-w-[220px]">{f.name}</span>
                            {selected && <IconCheck size={14} className="text-main-view-fg/80" />}
                          </div>
                        </DropdownMenuItem>
                      )
                    })}
                    {selectedProjects.length > 0 && (
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault()
                          setSelectedProjects([])
                        }}
                      >
                        <span className="text-sm text-main-view-fg/60">{t('common:clear')}</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Separate dropdown for the calendar picker */}
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="px-2 py-1 text-sm rounded-md border border-main-view-fg/10 hover:bg-main-view-fg/3"
                    >
                      {((startDateIso === '' && endDateIso === '') || (startDateIso === '1970-01-01' && endDateIso === '')) ? (
                        t('projects.filterByDate')
                      ) : startDateIso && !endDateIso ? (
                        formatIso(startDateIso)
                      ) : startDateIso && endDateIso ? (
                        `${formatIso(startDateIso)} → ${formatIso(endDateIso)}`
                      ) : (
                        t('projects.filterByDate')
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" className="w-72 max-h-80 overflow-y-auto z-[95]">
                    <div className="px-2 pb-2">
                      <CalendarPicker
                        startIso={startDateIso}
                        endIso={endDateIso}
                        onChange={(s, e) => {
                          setStartDateIso(s)
                          setEndDateIso(e)
                        }}
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            // Reset behaviour: start -> epoch (1970-01-01), end -> unset
                            setStartDateIso('1970-01-01')
                            setEndDateIso('')
                          }}
                          className="px-2 py-1 rounded text-sm border border-main-view-fg/10"
                        >
                          {t('common:clear')}
                        </button>
                      </div>
                      
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            {results.length === 0 ? (
              <div className="text-sm text-main-view-fg/60">{t('common:noResultsFound')}</div>
            ) : (
              results.map((thread: any) => {
                const title = thread.title || thread.metadata?.title || thread.id

                // determine date: prefer the last message timestamp, else pick the latest available timestamp
                const dateCandidates: any[] = []
                if (thread.last_message?.created_at) dateCandidates.push(thread.last_message.created_at)
                if (thread.messages && Array.isArray(thread.messages)) {
                  for (const m of thread.messages) {
                    if (m?.created_at) dateCandidates.push(m.created_at)
                    if (m?.timestamp) dateCandidates.push(m.timestamp)
                  }
                }
                dateCandidates.push(thread.updated_at, thread.created_at, thread.metadata?.updated_at, thread.metadata?.created_at)

                let dateStr = 'undefined'
                let latestTime = NaN
                for (const cand of dateCandidates) {
                  if (!cand) continue
                  let t = NaN
                  if (typeof cand === 'number') {
                    t = cand
                  } else if (typeof cand === 'string') {
                    // numeric string (epoch seconds or ms)
                    if (/^\d+$/.test(cand)) {
                      t = Number(cand)
                    } else {
                      const d = new Date(cand)
                      if (!isNaN(d.getTime())) t = d.getTime()
                    }
                  }

                  if (isNaN(t)) continue
                  // normalize seconds -> milliseconds (heuristic)
                  if (t < 1e12) t = t * 1000

                  if (isNaN(latestTime) || t > latestTime) latestTime = t
                }

                if (!isNaN(latestTime)) {
                  dateStr = new Date(latestTime).toLocaleString()
                }

                // build content for snippet
                let content = ''
                if (thread.preview) content += ' ' + String(thread.preview)
                if (thread.content) content += ' ' + String(thread.content)
                if (thread.messages && Array.isArray(thread.messages)) {
                  content += ' ' + thread.messages.map((m: any) => String(m.content || m.text || '')).join(' ')
                }

                const q = query.trim()
                const contentLower = content.toLowerCase()
                let snippet = ''
                if (q) {
                  const idx = contentLower.indexOf(q.toLowerCase())
                  if (idx !== -1) {
                    const SNIP_LEN = 80
                    const start = Math.max(0, idx - Math.floor(SNIP_LEN / 3))
                    const end = Math.min(content.length, start + SNIP_LEN)
                    snippet = (start > 0 ? '... ' : '') + content.slice(start, end) + (end < content.length ? ' ...' : '')
                  }
                }

                // highlight helper
                const renderHighlighted = (text: string, q: string) => {
                  if (!q) return text
                  const parts = text.split(new RegExp(`(${q.replace(/[-\\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'ig'))
                  return parts.map((part, i) =>
                    part.toLowerCase() === q.toLowerCase() ? (
                      <strong key={i} className="font-semibold">{part}</strong>
                    ) : (
                      <span key={i}>{part}</span>
                    )
                  )
                }
                console.log('Rendering thread', thread.id, { title, dateStr, snippet, q })

                return (
                  <div key={thread.id} className="py-1">
                    <Link
                      to="/threads/$threadId"
                      params={{ threadId: thread.id }}
                      onClick={() => onOpenChange(false)}
                      className="block px-2 py-1 rounded hover:bg-main-view-fg/10"
                    >
                      <div className="text-sm text-left-panel-fg/90 truncate whitespace-nowrap">{title}</div>
                      {dateStr && <div className="text-xs text-main-view-fg/60">{dateStr}</div>}
                      {snippet ? (
                        <div className="text-xs text-main-view-fg/60 truncate whitespace-nowrap">{renderHighlighted(snippet, q)}</div>
                      ) : (
                        thread.preview && (
                          <div className="text-xs text-main-view-fg/60 truncate whitespace-nowrap">{thread.preview}</div>
                        )
                      )}
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
