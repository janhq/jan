import { useEffect, useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import { toast } from 'sonner'
import { sessionWorkspacePath } from '@janhq/tauri-plugin-agent-tools-api'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import { getServiceHub } from '@/hooks/useServiceHub'
import { backendStorage } from '@/lib/backendStorage'
import { exportCoworkSession } from '@/lib/coworkExport'
import { retryCoworkImport } from '@/lib/coworkSync'

/** Ids whose "files left out" notice the user closed (JSON array). */
export const COWORK_LEFT_OUT_DISMISSED_KEY = 'cowork_left_out_dismissed'

type LeftOut = { skipped: number; unreadable: number }

const readDismissed = async (): Promise<string[]> => {
  try {
    const raw = await backendStorage.getItem(COWORK_LEFT_OUT_DISMISSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw as string) : []
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

const revealSessionFolder = async (id: string) => {
  const hub = getServiceHub()
  const dataFolder = await hub.app().getJanDataFolder()
  if (!dataFolder) throw new Error('no data folder')
  const folder = await sessionWorkspacePath(dataFolder, id)
  await hub.opener().revealItemInDir(folder)
}

/**
 * The banner above a Cowork conversation that cannot be used as usual, or
 * that the migration could not copy completely. Each case says what happened
 * in words, and what the user can do about it.
 */
export function CoworkSessionNotice({
  session,
}: {
  session: CoworkSession | null | undefined
}) {
  const { t } = useTranslation()
  const leftOut = useThreads(
    (s) =>
      (session &&
        (
          s.threads[session.id]?.metadata?.migratedFrom as
            | { leftOut?: LeftOut }
            | undefined
        )?.leftOut) ||
      undefined
  )
  const [dismissed, setDismissed] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!leftOut) return
    let live = true
    void readDismissed().then((ids) => live && setDismissed(ids))
    return () => {
      live = false
    }
  }, [leftOut])

  if (!session) return null

  const exportIt = async () => {
    try {
      const path = await exportCoworkSession(session)
      toast.success(t('common:coworkNotice.exported'), { description: path })
      await getServiceHub().opener().revealItemInDir(path)
    } catch (e) {
      toast.error(t('common:coworkNotice.exportFailed'), {
        description: String(e),
      })
    }
  }

  const retry = async () => {
    setBusy(true)
    try {
      const r = await retryCoworkImport(session.id)
      if (r.imported) toast.success(t('common:coworkNotice.imported'))
      else
        toast.error(t('common:coworkNotice.retryFailed'), {
          description: r.error,
        })
    } catch (e) {
      toast.error(t('common:coworkNotice.retryFailed'), {
        description: String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  if (session.unavailable) {
    const reason = session.unavailable
    return (
      <div
        role="alert"
        data-testid="cowork-session-notice"
        className="mx-auto mt-3 flex w-full max-w-3xl gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">
            {t(`common:coworkNotice.${reason}.title`)}
          </p>
          <p className="text-muted-foreground">
            {t(`common:coworkNotice.${reason}.body`)}
          </p>
          {reason === 'not-imported' && session.importError && (
            <p className="break-words font-mono text-xs text-muted-foreground">
              {t('common:coworkNotice.reason', { reason: session.importError })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {reason === 'not-imported' && (
              <Button size="sm" disabled={busy} onClick={() => void retry()}>
                {t(
                  busy
                    ? 'common:coworkNotice.retrying'
                    : 'common:coworkNotice.retry'
                )}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void exportIt()}>
              {t('common:coworkNotice.export')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!leftOut || dismissed === null || dismissed.includes(session.id))
    return null
  const dismiss = () => {
    const next = [...dismissed, session.id]
    setDismissed(next)
    void backendStorage.setItem(
      COWORK_LEFT_OUT_DISMISSED_KEY,
      JSON.stringify(next)
    )
  }
  return (
    <div
      role="status"
      data-testid="cowork-left-out-notice"
      className="mx-auto mt-3 flex w-full max-w-3xl gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{t('common:coworkNotice.leftOut.title')}</p>
        <p className="text-muted-foreground">
          {t('common:coworkNotice.leftOut.body', {
            count: leftOut.skipped + leftOut.unreadable,
          })}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void revealSessionFolder(session.id).catch((e) =>
              toast.error(t('common:coworkNotice.revealFailed'), {
                description: String(e),
              })
            )
          }
        >
          {t('common:coworkNotice.leftOut.show')}
        </Button>
      </div>
      <button
        type="button"
        aria-label={t('common:close')}
        onClick={dismiss}
        className="self-start rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
