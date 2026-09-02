/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { ChevronsUpDown } from 'lucide-react'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { CoworkArtifactCard } from '@/containers/CoworkArtifactCard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { route } from '@/constants/routes'
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
  component: ArtifactsPage,
})

const PAGE = 24

type Row = CoworkArtifact & { sessionId: string; root: string | null }

/**
 * Each session's sandbox, keyed by id.
 *
 * Artifacts only ever live there: an attached folder is mounted read-only, so
 * every write the agent lands is inside the sandbox. Resolving against
 * `session.folder` pointed at a path that does not exist -- and at nothing at
 * all for a session with no folder attached, which hid Open and the thumbnails
 * entirely.
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
        const root = workspaces[session.id] ?? null
        return artifactsFromTurns(session.turns, root).map((artifact) => ({
          ...artifact,
          sessionId: session.id,
          root,
        }))
      }),
    [sessions, workspaces]
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!group || r.group === group) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          r.path.toLowerCase().includes(q))
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
      {/* Search in the header, dropdown filter on the right — the hub page's
          layout, so this reads as part of Jan rather than its own thing. */}
      <HeaderPage>
        <div className="relative z-20 flex h-10 w-full items-center justify-between py-3 pr-3">
          <div className="flex w-full items-center gap-2">
            <IconSearch size={14} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common:artifactsSearch')}
              className="w-full focus:outline-none"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0">
                {group
                  ? t(`common:artifactGroup${group}`)
                  : t('common:artifactsAll')}
                <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem onClick={() => setGroup(null)}>
                {t('common:artifactsAll')}
              </DropdownMenuItem>
              {ARTIFACT_GROUP_NAMES.map((g) => (
                <DropdownMenuItem key={g} onClick={() => setGroup(g)}>
                  {t(`common:artifactGroup${g}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </HeaderPage>

      <div className="h-[calc(100%-60px)] w-full overflow-y-auto p-4">
        <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {/* Distinct: nothing made yet vs nothing matching the filter. */}
              {rows.length === 0
                ? t('common:artifactsEmpty')
                : t('common:artifactsNoMatch')}
            </p>
          ) : (
            <div className="grid auto-rows-min gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.slice(0, limit).map((row) => (
                <CoworkArtifactCard
                  key={`${row.sessionId}:${row.path}`}
                  artifact={row}
                  root={row.root}
                  onPreview={() => open(row)}
                  showPath
                />
              ))}
            </div>
          )}
          {shown.length > limit && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                {t('common:artifactsShowMore', { count: shown.length - limit })}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
