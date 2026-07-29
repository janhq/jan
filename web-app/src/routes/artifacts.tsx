/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import HeaderPage from '@/containers/HeaderPage'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCodeSessions } from '@/hooks/useCodeSessions'
import { useCodeRun } from '@/hooks/useCodeRun'
import {
  ARTIFACT_GROUP_NAMES,
  ARTIFACT_ICON,
  artifactsFromTurns,
  type CodeArtifact,
} from '@/lib/codeArtifacts'

export const Route = createFileRoute(route.artifacts as any)({
  component: ArtifactsPage,
})

type Row = CodeArtifact & { sessionId: string }

function ArtifactsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sessions = useCodeSessions((s) => s.sessions)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<CodeArtifact['group'] | null>(null)

  // ponytail: derived from the sessions already on disk rather than a durable
  // artifact store (#299). No registration path, no migration — the trade-off
  // is that an artifact disappears if its session is deleted. Add the store
  // when artifacts need to outlive their session.
  // ponytail: derived from the sessions already on disk rather than a durable
  // artifact store (#299). No registration path, no migration — the trade-off
  // is that an artifact disappears if its session is deleted. Add the store
  // when artifacts need to outlive their session.
  const rows = useMemo<Row[]>(
    () =>
      sessions.flatMap((session) =>
        artifactsFromTurns(session.turns).map((artifact) => ({
          ...artifact,
          sessionId: session.id,
        }))
      ),
    [sessions]
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!group || r.group === group) &&
        (!q || r.title.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
    )
  }, [rows, query, group])

  const open = (row: Row) => {
    useCodeSessions.getState().selectSession(row.sessionId)
    useCodeRun.getState().requestPreview(row.sessionId, row.path)
    navigate({ to: route.code })
  }

  return (
    <div className="flex h-full w-full flex-col">
      <HeaderPage>
        <h1 className="font-medium">{t('common:artifacts')}</h1>
      </HeaderPage>

      <div className="flex flex-1 flex-col overflow-hidden px-6 py-4">
        <div className="mb-4 flex shrink-0 items-center gap-2">
          <div className="relative w-64">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-main-view-fg/40"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common:artifactsSearch')}
              className="h-8 pl-8"
            />
          </div>
          <Button
            variant={group === null ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8"
            onClick={() => setGroup(null)}
          >
            {t('common:artifactsAll')}
          </Button>
          {ARTIFACT_GROUP_NAMES.map((g) => (
            <Button
              key={g}
              variant={group === g ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setGroup(g)}
            >
              {g}
            </Button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-main-view-fg/50">
            {/* Distinct messages: nothing made yet vs nothing matching. */}
            {rows.length === 0 ? t('common:artifactsEmpty') : t('common:artifactsNoMatch')}
          </p>
        ) : (
          <div className="grid flex-1 auto-rows-min gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((row) => {
              const Icon = ARTIFACT_ICON[row.group]
              return (
                <button
                  key={`${row.sessionId}:${row.path}`}
                  type="button"
                  onClick={() => open(row)}
                  title={row.path}
                  className={cn(
                    'flex flex-col gap-3 rounded-xl border bg-main-view p-4 text-left',
                    'transition-colors hover:border-main-view-fg/25'
                  )}
                >
                  <span className="flex size-11 items-center justify-center rounded-lg border bg-main-view-fg/[0.03]">
                    <Icon size={18} className="text-main-view-fg/50" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">
                      {row.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-main-view-fg/55">
                      {row.group} · {row.label}
                    </span>
                    <span className="mt-1.5 block truncate text-xs text-main-view-fg/45">
                      {row.path}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
