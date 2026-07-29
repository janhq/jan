import { useCallback, useEffect, useState } from 'react'
import { ExtensionManager } from '@/lib/extension'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

export type BackendUpdateRecord = {
  timestamp: string
  from: string
  to: string
  outcome: 'updated' | 'rolled-back' | 'rollback-failed' | 'failed'
  durationMs: number
  error?: string
}

type HistoryProvider = {
  getBackendUpdateHistory: () => Promise<BackendUpdateRecord[]>
}

function getHistoryProvider(): HistoryProvider | null {
  const extension = ExtensionManager.getInstance().getByName(
    'llamacpp-extension'
  )
  return extension && 'getBackendUpdateHistory' in extension
    ? (extension as unknown as HistoryProvider)
    : null
}

const OUTCOME_LABELS: Record<BackendUpdateRecord['outcome'], string> = {
  updated: 'providers:backendHistoryUpdated',
  'rolled-back': 'providers:backendHistoryRolledBack',
  'rollback-failed': 'providers:backendHistoryRollbackFailed',
  failed: 'providers:backendHistoryFailed',
}

export function BackendUpdateHistory() {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [records, setRecords] = useState<BackendUpdateRecord[] | null>(null)

  const load = useCallback(async () => {
    const provider = getHistoryProvider()
    if (!provider) {
      setRecords([])
      return
    }
    try {
      setRecords(await provider.getBackendUpdateHistory())
    } catch {
      setRecords([])
    }
  }, [])

  useEffect(() => {
    if (expanded) void load()
  }, [expanded, load])

  return (
    <div className="mt-2 w-full">
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-muted-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded
          ? t('providers:backendHistoryHide')
          : t('providers:backendHistoryShow')}
      </Button>

      {expanded && (
        <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border">
          {records === null && (
            <p className="p-3 text-sm text-muted-foreground">
              {t('providers:backendHistoryLoading')}
            </p>
          )}
          {records?.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              {t('providers:backendHistoryEmpty')}
            </p>
          )}
          {records?.map((record, index) => (
            <div
              key={`${record.timestamp}-${index}`}
              className="border-b border-border p-3 text-sm last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {record.from || t('providers:backendHistoryNone')} &rarr;{' '}
                  {record.to}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    record.outcome === 'updated'
                      ? 'text-muted-foreground'
                      : 'text-destructive'
                  )}
                >
                  {t(OUTCOME_LABELS[record.outcome])}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(record.timestamp).toLocaleString()}
                {' · '}
                {Math.round(record.durationMs / 1000)}s
              </div>
              {record.error && (
                <p className="mt-1 break-words text-xs text-destructive">
                  {record.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
