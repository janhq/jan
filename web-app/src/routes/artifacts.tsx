/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { Box, SearchX } from 'lucide-react'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { CoworkArtifactCard } from '@/containers/CoworkArtifactCard'
import { route } from '@/constants/routes'
import { ensureCoworkEnabled } from '@/lib/coworkAccess'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { getServiceHub } from '@/hooks/useServiceHub'
import { sessionWorkspacePath } from '@janhq/tauri-plugin-agent-tools-api'
import {
  ARTIFACT_GROUP_NAMES,
  artifactsFromTurns,
  type CoworkArtifact,
} from '@/lib/coworkArtifacts'

export const Route = createFileRoute(route.artifacts as any)({
  beforeLoad: () => ensureCoworkEnabled(),
  component: ArtifactsPage,
})

const PAGE = 24

type Row = CoworkArtifact & {
  sessionId: string
  sessionTitle: string
  updated: number
  roots: Array<string | null>
}

/**
 * Each session's sandbox, keyed by id.
 *
 * A session writes into two places: its own sandbox and, since the shared
 * folder became writable, the attached project folder. Both are resolution
 * roots, so an artifact the agent wrote into the folder is still openable here.
 */
function useSessionWorkspaces(sessionIds: string[]): Record<string, string> {
  const [paths, setPaths] = useState<Record<string, string>>({})
  const key = sessionIds.join(',')

  useEffect(() => {
    let alive = true
    void (async () => {
      const dataFolder = await getServiceHub().app().getJanDataFolder()
      if (!dataFolder) return
      const found = await Promise.all(
        key
          .split(',')
          .filter(Boolean)
          .map(async (id) => {
            try {
              return [id, await sessionWorkspacePath(dataFolder, id)] as const
            } catch {
              return [id, ''] as const
            }
          })
      )
      if (alive) {
        setPaths(Object.fromEntries(found.filter(([, path]) => path)))
      }
    })()
    return () => {
      alive = false
    }
  }, [key])

  return paths
}

function ArtifactsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sessions = useCoworkSessions((s) => s.sessions)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<CoworkArtifact['group'] | null>(null)
  // ponytail: a render cap with "show more" rather than paging or a virtual
  // list. Search and the kind filter already narrow the set, and DOM size was
  // the only real cost. Swap for virtualization if this hits thousands.
  const [limit, setLimit] = useState(PAGE)

  // ponytail: derived from the sessions already on disk rather than a durable
  // artifact store (#299). No registration path, no migration — the trade-off
  // is that an artifact disappears if its session is deleted. See #310 for why
  // that store needs splitting before it can carry artifact records.
  const workspaces = useSessionWorkspaces(
    useMemo(() => sessions.map((s) => s.id), [sessions])
  )

  const rows = useMemo<Row[]>(
    () =>
      sessions.flatMap((session) => {
        const sandbox = workspaces[session.id] ?? null
        // The attached folder is the workspace root (#8882), so it comes first:
        // a relative tool path resolves against it, the sandbox is the fallback.
        const root = session.folder ?? sandbox
        return artifactsFromTurns(session.turns, root).map((artifact) => ({
          ...artifact,
          sessionId: session.id,
          sessionTitle: session.title,
          updated: session.updated,
          roots: [session.folder, sandbox],
        }))
      }).sort((a, b) => b.updated - a.updated),
    [sessions, workspaces]
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!group || r.group === group) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          r.path.toLowerCase().includes(q) ||
          r.sessionTitle.toLowerCase().includes(q))
    )
  }, [rows, query, group])

  // Narrowing the set should start from the top again.
  useEffect(() => setLimit(PAGE), [query, group])

  const open = (row: Row) => {
    useCoworkSessions.getState().selectSession(row.sessionId)
    useCoworkRun.getState().requestPreview(row.sessionId, row.path)
    navigate({ to: route.cowork })
  }

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage />
      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 md:px-8">
        <div className="mx-auto w-full max-w-5xl pt-3 md:pt-5">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-medium tracking-tight text-foreground">{t('common:artifacts')}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('common:artifactsLibraryDescription')}</p>
            </div>
            <span className="mt-2 shrink-0 text-sm tabular-nums text-muted-foreground">{t('common:artifactsLibraryCount', { count: rows.length })}</span>
          </div>
          <div className="mb-6 space-y-3">
            <div className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 focus-within:ring-2 focus-within:ring-ring/30">
              <IconSearch size={17} className="shrink-0 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('common:artifactsSearch')} placeholder={t('common:artifactsSearch')} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </div>
            <div role="group" aria-label={t('common:artifactsLibraryFilter')} className="flex flex-wrap items-center gap-1.5">
              {[null, ...ARTIFACT_GROUP_NAMES].map((g) => (
                <button key={g ?? 'all'} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${group === g ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  {g ? t(`common:artifactGroup${g}`) : t('common:artifactsAll')}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
              {rows.length === 0 ? <Box className="mb-4 size-8 text-muted-foreground/60" strokeWidth={1.4} /> : <SearchX className="mb-4 size-8 text-muted-foreground/60" strokeWidth={1.4} />}
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">{rows.length === 0 ? t('common:artifactsEmpty') : t('common:artifactsNoMatch')}</p>
              {rows.length > 0 && <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setQuery(''); setGroup(null) }}>{t('common:artifactsLibraryReset')}</Button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {shown.slice(0, limit).map((row) => (
                <CoworkArtifactCard key={`${row.sessionId}:${row.path}`} variant="library" artifact={row} roots={row.roots} onPreview={() => open(row)} showPath />
              ))}
            </div>
          )}
          {shown.length > limit && (
            <div className="mt-7 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE)}>{t('common:artifactsShowMore', { count: shown.length - limit })}</Button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
