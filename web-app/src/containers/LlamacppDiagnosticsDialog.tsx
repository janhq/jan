import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import { groupForOp, hasCpuFallback } from '@/lib/diagnosticsGroups'
import { formatDiagnosticsReport } from '@/lib/diagnosticsReport'
import type { DiagnosticsRun } from '@/hooks/useLlamacppDiagnostics'
import { groupLabelKeys, VERDICT_STYLES } from './llamacppDiagnosticsStatus'

type StatusFilter = 'all' | 'fail' | 'not_supported' | 'ok'

const STATUS_FILTERS: { value: StatusFilter; key: string }[] = [
  { value: 'fail', key: 'providers:diagnostics.filterFailed' },
  { value: 'not_supported', key: 'providers:diagnostics.filterFallback' },
  { value: 'ok', key: 'providers:diagnostics.filterPassed' },
  { value: 'all', key: 'providers:diagnostics.filterAll' },
]

const STATUS_LABEL: Record<string, string> = {
  ok: 'providers:diagnostics.statusOk',
  fail: 'providers:diagnostics.statusFail',
  not_supported: 'providers:diagnostics.statusNotSupported',
  skipped: 'providers:diagnostics.statusSkipped',
}

const STATUS_STYLE: Record<string, string> = {
  ok: VERDICT_STYLES.passed.text,
  fail: VERDICT_STYLES.failed.text,
  not_supported: VERDICT_STYLES.fallback.text,
  skipped: 'text-muted-foreground',
}

/**
 * Every case of a run, for someone filing a bug.
 *
 * The operation column carries both readings: the plain name on top, the
 * llama.cpp op underneath in mono. A reader who came from the summary
 * recognises the first; a maintainer needs the second to re-run the case, and
 * neither has to switch views to get it.
 */
export function LlamacppDiagnosticsDialog({
  run,
  open,
  onOpenChange,
}: {
  run: DiagnosticsRun
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<StatusFilter>('fail')
  const [device, setDevice] = useState('all')
  const [query, setQuery] = useState('')

  const cpuDevices = useMemo(
    () =>
      new Set(
        run.devices
          .filter((d) => !hasCpuFallback(d.device.type))
          .map((d) => d.device.name)
      ),
    [run.devices]
  )

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return run.cases.filter((c) => {
      if (status !== 'all' && c.status !== status) return false
      if (device !== 'all' && c.device !== device) return false
      if (!needle) return true
      return (
        c.op.toLowerCase().includes(needle) ||
        c.params.toLowerCase().includes(needle)
      )
    })
  }, [run.cases, status, device, query])

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        formatDiagnosticsReport(run, {}, { allCases: true })
      )
      toast.success(t('providers:diagnostics.copied'))
    } catch {
      toast.error(t('providers:diagnostics.copyFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 lg:max-w-3xl xl:max-w-4xl">
        <DialogHeader className="px-5 py-4">
          <DialogTitle>{t('providers:diagnostics.allCasesTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-y border-border/60 px-5 py-3">
          <div className="flex items-center gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={cn(
                  'cursor-pointer rounded-md border px-2 py-0.5 text-xs transition-colors',
                  status === f.value
                    ? 'border-primary/60 text-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                )}
              >
                {t(f.key)}
              </button>
            ))}
          </div>
          {run.devices.length > 1 && (
            <div className="flex items-center gap-1">
              {['all', ...run.devices.map((d) => d.device.name)].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setDevice(name)}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-0.5 font-mono text-xs transition-colors',
                    device === name
                      ? 'border-primary/60 text-foreground'
                      : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                  )}
                >
                  {name === 'all'
                    ? t('providers:diagnostics.filterAll')
                    : name}
                </button>
              ))}
            </div>
          )}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('providers:diagnostics.searchCases')}
            className="h-7 w-full min-w-40 flex-1 text-xs sm:w-auto"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              {t('providers:diagnostics.noCases')}
            </p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border/60">
                  <th className="px-5 py-2 text-xs font-normal text-muted-foreground">
                    {t('providers:diagnostics.columnOp')}
                  </th>
                  <th className="px-3 py-2 text-xs font-normal text-muted-foreground">
                    {t('providers:diagnostics.columnParams')}
                  </th>
                  <th className="px-5 py-2 text-right text-xs font-normal text-muted-foreground">
                    {t('providers:diagnostics.columnStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr
                    key={`${c.device}-${c.op}-${c.params}-${i}`}
                    className="border-b border-border/40 last:border-none"
                  >
                    <td className="px-5 py-2.5 align-top">
                      <div className="text-sm text-foreground">
                        {t(groupLabelKeys(groupForOp(c.op)).label)}
                      </div>
                      <div
                        className="font-mono text-xs text-muted-foreground"
                        title={t('providers:diagnostics.opColumnHint')}
                      >
                        {c.op}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-mono text-xs break-all text-muted-foreground">
                        {c.params}
                      </div>
                      {(c.error || c.detail) && (
                        <div className="mt-1 font-mono text-xs break-all text-red-600 dark:text-red-400">
                          {c.error ?? c.detail}
                        </div>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-5 py-2.5 text-right align-top text-xs whitespace-nowrap',
                        STATUS_STYLE[c.status]
                      )}
                    >
                      {/* "Runs on CPU" is circular on a CPU row: there is
                          nowhere below it to run. */}
                      {c.status === 'not_supported' && cpuDevices.has(c.device)
                        ? t('providers:diagnostics.statusNotImplemented')
                        : t(STATUS_LABEL[c.status] ?? c.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {rows.length}
          </span>
          <div className="flex items-center gap-2">
            {run.casesTruncated && (
              <span className="text-xs text-muted-foreground">
                {t('providers:diagnostics.casesTruncated', {
                  count: run.cases.length,
                })}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={copyAll}>
              {t('providers:diagnostics.copyResults')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
