import { useEffect, useMemo, useState } from 'react'
import {
  IconChevronDown,
  IconLoader2,
  IconStethoscope,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, formatMegaBytes } from '@/lib/utils'
import {
  deviceVerdict,
  tallyOf,
  groupForOp,
  isQuantizedCase,
  type DiagnosticsGroup,
} from '@/lib/diagnosticsGroups'
import { formatDiagnosticsReport } from '@/lib/diagnosticsReport'
import { localHomeDir } from '@/lib/localHome'
import {
  diagnosticsSuggestions,
  type DiagnosticsSuggestion,
} from '@/lib/diagnosticsSuggestions'
import {
  isFinished,
  useLlamacppDiagnostics,
  unsupportedOps,
  type DiagnosticsDeviceRun,
  type DiagnosticsRun,
} from '@/hooks/useLlamacppDiagnostics'
import { groupLabelKeys, VERDICT_STYLES } from './llamacppDiagnosticsStatus'
import { LlamacppDiagnosticsDialog } from './LlamacppDiagnosticsDialog'
import { LlamacppDiagnosticsFullConfirm } from './LlamacppDiagnosticsFullConfirm'

/** Group rollup for one device, worst group first. */
interface GroupResult {
  group: DiagnosticsGroup
  failed: number
  fallback: number
  /** Cases behind `fallback`, so the row can say 12 of 185 rather than 12. */
  fallbackTotal: number
}

function groupResults(
  run: DiagnosticsRun,
  device: DiagnosticsDeviceRun,
  canOffload: boolean
): { groups: GroupResult[]; quantizedFailures: number } {
  const name = device.device.name
  const byGroup = new Map<DiagnosticsGroup, GroupResult>()
  const entryFor = (op: string) => {
    const group = groupForOp(op)
    const entry = byGroup.get(group) ?? {
      group,
      failed: 0,
      fallback: 0,
      fallbackTotal: 0,
    }
    byGroup.set(group, entry)
    return entry
  }
  let quantizedFailures = 0
  // Failures come from `cases`, which never drops one.
  for (const c of run.cases) {
    if (c.device !== name || c.status !== 'fail') continue
    entryFor(c.op).failed += 1
    if (isQuantizedCase(c.params)) quantizedFailures += 1
  }
  // Fallbacks come from `opSupport`, which is counted off every event --
  // `cases` caps non-failing ones and would undercount a long run. Skipped
  // entirely on the CPU, which has nowhere to offload to.
  if (canOffload) {
    for (const op of unsupportedOps(device)) {
      const entry = entryFor(op.op)
      entry.fallback += op.notSupported
      entry.fallbackTotal += op.ok + op.notSupported
    }
  }
  const groups = [...byGroup.values()].sort(
    (a, b) => b.failed - a.failed || b.fallback - a.fallback
  )
  return { groups, quantizedFailures }
}

function DeviceRow({
  device,
  run,
}: {
  device: DiagnosticsDeviceRun
  run: DiagnosticsRun
}) {
  const { t } = useTranslation()
  const crashed = device.crashed > 0 || device.hung > 0
  const tally = tallyOf(device)
  const verdict = deviceVerdict(tally)
  const style = VERDICT_STYLES[verdict]
  const { groups, quantizedFailures } = groupResults(
    run,
    device,
    tally.canOffload
  )

  const detail = crashed
    ? t('providers:diagnostics.verdictCrashedDetail')
    : verdict === 'failed'
      ? t('providers:diagnostics.verdictFailedDetail', { count: device.failed })
      : verdict === 'inconclusive'
        ? device.noCases > 0
          ? t('providers:diagnostics.verdictInconclusiveDetail', {
              count: device.noCases,
            })
          : t('providers:diagnostics.verdictPartialDetail')
        : verdict === 'fallback'
          ? t('providers:diagnostics.verdictFallbackDetail', {
              count: unsupportedOps(device).length,
            })
          : verdict === 'passed'
            ? // A CPU with unsupported cases still passes, but the technical
              // table will show those rows, so say up front why they are there.
              !tally.canOffload && device.notSupported > 0
              ? t('providers:diagnostics.verdictCpuUnsupportedDetail')
              : t('providers:diagnostics.verdictPassedDetail')
            : t('providers:diagnostics.verdictUnknownDetail')

  const headline = crashed
    ? t('providers:diagnostics.verdictCrashed')
    : t(
        `providers:diagnostics.verdict${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}`
      )

  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 border-l-2 p-3',
        style.edge
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-foreground">
            {device.device.name === device.device.description
              ? device.device.name
              : device.device.description}
          </h3>
          <p className={cn('mt-0.5 text-sm', style.text)}>{headline}</p>
        </div>
        {/* The backend chip from the hardware page, carrying the verdict in
            its dot. An icon here read as a close button, and the device id
            (CUDA0) is what tells two identical cards apart. */}
        <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs tracking-wider text-foreground">
          <span className={cn('size-1.5 rounded-full', style.dot)} />
          {device.device.name}
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
        {detail}
      </p>

      {device.complete && (
        <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
          <Fact
            label={t('providers:diagnostics.passedLabel')}
            value={`${device.ok.toLocaleString()} / ${(device.ok + device.failed).toLocaleString()}`}
          />
          {device.device.memory_free_mib !== undefined && (
            <Fact
              label={t('settings:hardware.vram')}
              value={formatMegaBytes(device.device.memory_free_mib)}
            />
          )}
        </dl>
      )}

      {/* Only once this device has a summary: a breakdown printed under
          "Not checked" contradicts it, and the counts are partial until the
          support probe for this device has finished. */}
      {device.complete && groups.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {groups.map((g) => {
            const keys = groupLabelKeys(g.group)
            const bad = g.failed > 0
            return (
              <li key={g.group} className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    bad ? VERDICT_STYLES.failed.dot : VERDICT_STYLES.fallback.dot
                  )}
                />
                <div className="min-w-0">
                  <span className="text-sm text-foreground">{t(keys.label)}</span>{' '}
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {bad
                      ? t('providers:diagnostics.casesFailed', {
                          count: g.failed,
                        })
                      : t('providers:diagnostics.casesFallback', {
                          count: g.fallback,
                          total: g.fallbackTotal,
                        })}
                  </span>
                  <p className="text-xs leading-normal text-muted-foreground">
                    {t(keys.detail)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {quantizedFailures > 0 && (
        // A callout, not a second verdict: loose red text at this width
        // competed with the headline for the eye.
        <p className="mt-2.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs leading-normal text-red-600 dark:text-red-400">
          {t('providers:diagnostics.quantizedDetail')}
        </p>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  )
}

/**
 * What to do about the result, each with the observation it came from.
 *
 * Plain language throughout: the groups name what a kernel is for, and the
 * ggml op names stay in the technical details table.
 */
function Suggestions({
  suggestions,
}: {
  suggestions: DiagnosticsSuggestion[]
}) {
  const { t } = useTranslation()
  if (suggestions.length === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-border/60 p-3">
      <h3 className="font-medium text-foreground">
        {t('providers:diagnostics.suggestionsTitle')}
      </h3>
      <ol className="mt-2 space-y-2.5">
        {suggestions.map((s) => {
          const key = `${s.id}-${s.device}`
          const label = s.id.charAt(0).toUpperCase() + s.id.slice(1)
          const groups = s.groups
            .map((g) => t(groupLabelKeys(g).label))
            .join(', ')
          return (
            <li key={key}>
              <p className="text-sm text-foreground">
                {t(`providers:diagnostics.suggestion${label}`, s.values)}
              </p>
              <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
                {t(`providers:diagnostics.suggestion${label}Detail`, s.values)}
              </p>
              {groups && (
                <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
                  {t('providers:diagnostics.suggestionEvidence', { groups })}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * One preset in the run menu.
 *
 * The duration sits under the name rather than beside it: the two were a
 * `justify-between` row, and at the menu's width "15 minutes or more per
 * device" left the name too little room, so it broke mid-label ("Full /
 * check") and the rows came out ragged. Stacked, every row is the same
 * height whatever a translation does to the hint.
 */
function PresetItem({
  label,
  hint,
  onSelect,
}: {
  label: string
  hint: string
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <div className="flex w-full flex-col gap-0.5">
        <span>{label}</span>
        <span className="text-xs leading-snug text-muted-foreground">
          {hint}
        </span>
      </div>
    </DropdownMenuItem>
  )
}

/**
 * The hardware check, on the llama.cpp provider page beside the engine panel.
 *
 * Two readers at once. The default view answers "is my machine the problem?"
 * in a sentence per device and never shows a ggml op name; the dialog behind
 * `Show all cases` carries every case, its parameters and its error for
 * someone filing a bug. Nothing is sent anywhere.
 */
export function LlamacppDiagnostics({
  busy = false,
  deviceHint,
  modelHint,
}: {
  /** The engine is generating or loading. Supplied by the route, which already
   *  knows this page is llama.cpp's. */
  busy?: boolean
  /** Device to pre-select, from the hardware page's per-device entry point. */
  deviceHint?: string
  /** Model to check, from a failed load's "check why this model failed". Its
   *  presence is what offers the model preset at all: without a model there is
   *  no gguf to read a shape from. */
  modelHint?: string
} = {}) {
  const { t } = useTranslation()
  const { run, starting, running, start, cancel } = useLlamacppDiagnostics()
  const [device, setDevice] = useState(deviceHint ?? 'all')
  const [showCases, setShowCases] = useState(false)
  const [confirmFull, setConfirmFull] = useState(false)
  // A generation that began after the run did makes the timings, and a
  // memory-starved failure, untrustworthy -- but the results so far are still
  // real, so this reports rather than cancels.
  const [disturbed, setDisturbed] = useState(false)
  useEffect(() => {
    if (busy && running) setDisturbed(true)
  }, [busy, running])

  // Accumulated, not taken from the last run alone: a run narrowed to one
  // device reports only that device, which would shrink the list, hide the
  // selector and pin every later run to it with no way back to 'all'.
  const [devices, setDevices] = useState<string[]>([])
  useEffect(() => {
    const seen = run?.devices.map((d) => d.device.name) ?? []
    if (seen.length === 0) return
    setDevices((prev) => {
      const merged = prev.concat(seen.filter((name) => !prev.includes(name)))
      return merged.length === prev.length ? prev : merged
    })
  }, [run])
  const finished = run ? isFinished(run.status) : false

  const runPreset = (preset: 'quick' | 'full' | 'model') => {
    setDisturbed(false)
    return start(preset, device === 'all' ? [] : [device], modelHint)
  }

  const suggestions = useMemo(
    () => (run && finished ? diagnosticsSuggestions(run) : []),
    [run, finished]
  )

  const copy = async () => {
    if (!run) return
    try {
      await navigator.clipboard.writeText(
        formatDiagnosticsReport(run, { home: await localHomeDir() })
      )
      toast.success(t('providers:diagnostics.copied'))
    } catch {
      toast.error(t('providers:diagnostics.copyFailed'))
    }
  }

  return (
    <div className="rounded-lg border border-main-view-fg/10 bg-main-view-fg/5 p-4">
      <div className="flex items-center gap-2">
        <IconStethoscope
          size={18}
          className="shrink-0 text-muted-foreground"
        />
        <span className="font-medium text-foreground">
          {t('providers:diagnostics.title')}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
        {t('providers:diagnostics.description')}
      </p>

      {running && run && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-sm text-foreground">
              {run.current
                ? t('providers:diagnostics.checking', {
                    family: run.current.family,
                    device: run.current.device,
                  })
                : run.model
                  ? t('providers:diagnostics.modelOf', { model: run.model })
                  : t('providers:diagnostics.preparing')}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {t('providers:diagnostics.progress', {
                done: run.finishedUnits,
                total: run.totalUnits || '?',
              })}
            </span>
          </div>
          <Progress
            value={
              run.totalUnits > 0
                ? (run.finishedUnits / run.totalUnits) * 100
                : 0
            }
            className="mt-1.5 h-1.5 w-full border"
          />
        </div>
      )}

      {run && run.devices.length > 0 && (
        <div className="mt-3 space-y-2">
          {run.devices.map((d) => (
            <DeviceRow key={d.device.name} device={d} run={run} />
          ))}
        </div>
      )}

      <Suggestions suggestions={suggestions} />

      {run?.status === 'inconclusive' && (
        <p className="mt-3 rounded-md bg-secondary px-2.5 py-1.5 text-xs leading-normal text-muted-foreground">
          {t('providers:diagnostics.inconclusiveNotice')}
        </p>
      )}

      {run?.status === 'error' && run.error && (
        <p className="mt-3 text-xs leading-normal text-red-600 dark:text-red-400">
          {t('providers:diagnostics.stoppedEarly', { reason: run.error })}
        </p>
      )}
      {run?.status === 'cancelled' && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('providers:diagnostics.cancelled')}
        </p>
      )}

      {busy && !running && (
        <p className="mt-3 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs leading-normal text-amber-700 dark:text-amber-400">
          {t('providers:diagnostics.busyBlocked')}
        </p>
      )}
      {disturbed && (
        <p className="mt-3 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs leading-normal text-amber-700 dark:text-amber-400">
          {t('providers:diagnostics.busyDuringRun')}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
        {running ? (
          <Button variant="outline" size="sm" onClick={cancel}>
            {t('providers:diagnostics.cancel')}
          </Button>
        ) : (
          <div className="flex items-center">
            <Button
              size="sm"
              disabled={starting || busy}
              onClick={() => runPreset(modelHint ? 'model' : 'quick')}
              className="rounded-r-none pr-3"
            >
              {starting && (
                <IconLoader2 size={14} className="animate-spin" />
              )}
              {finished
                ? t('providers:diagnostics.runAgain')
                : modelHint
                  ? t('providers:diagnostics.model')
                  : t('providers:diagnostics.run')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={starting || busy}
                  aria-label={t('providers:diagnostics.runOptions')}
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                >
                  <IconChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {modelHint && (
                  <PresetItem
                    label={t('providers:diagnostics.model')}
                    hint={t('providers:diagnostics.modelHint')}
                    onSelect={() => runPreset('model')}
                  />
                )}
                <PresetItem
                  label={t('providers:diagnostics.quick')}
                  hint={t('providers:diagnostics.quickHint')}
                  onSelect={() => runPreset('quick')}
                />
                <PresetItem
                  label={t('providers:diagnostics.full')}
                  hint={t('providers:diagnostics.fullHint')}
                  onSelect={() => setConfirmFull(true)}
                />
                {(devices.length > 1 || device !== 'all') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {t('providers:diagnostics.device')}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={device}
                      onValueChange={setDevice}
                    >
                      <DropdownMenuRadioItem value="all">
                        {t('providers:diagnostics.allDevices')}
                      </DropdownMenuRadioItem>
                      {devices.map((name) => (
                        <DropdownMenuRadioItem key={name} value={name}>
                          {name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Secondary actions sit opposite the primary one; without the gap
            the two links read as a single phrase. */}
        <div className="ml-auto flex items-center gap-4">
          {run && run.cases.length > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-muted-foreground hover:text-foreground"
              onClick={() => setShowCases(true)}
            >
              {t('providers:diagnostics.technicalDetails')}
            </Button>
          )}
          {finished && run && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-muted-foreground hover:text-foreground"
              onClick={copy}
            >
              {t('providers:diagnostics.copyResults')}
            </Button>
          )}
        </div>
      </div>

      {run && (
        <LlamacppDiagnosticsDialog
          run={run}
          open={showCases}
          onOpenChange={setShowCases}
        />
      )}
      <LlamacppDiagnosticsFullConfirm
        open={confirmFull}
        onOpenChange={setConfirmFull}
        onConfirm={() => {
          setConfirmFull(false)
          runPreset('full')
        }}
      />
    </div>
  )
}
