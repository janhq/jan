import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const threadsMap = useThreads((s) => s.threads)

  const allThreads = useMemo(() => Object.values(threadsMap), [threadsMap])

  const results = useMemo(() => {
    if (!query) return allThreads
    const q = query.toLowerCase()
    return allThreads.filter((t: any) => {
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
  }, [allThreads, query])

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

                let dateStr = ''
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
