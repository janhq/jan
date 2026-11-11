import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelDiagnostics,
  onDiagnosticsEvent,
  startDiagnostics,
  type DiagnosticsCaseStatus,
  type DiagnosticsDevice,
  type DiagnosticsEngineBuild,
  type DiagnosticsEvent,
  type DiagnosticsFamilyStatus,
  type DiagnosticsPreset,
} from '@janhq/tauri-plugin-llamacpp-api'

/**
 * Non-failing cases kept for the detail table. Failures are always kept in
 * full -- they are what the screen exists for and are rare -- but a Full run
 * emits tens of thousands of passes per device, and holding them all would
 * cost more memory than the answer is worth.
 */
const PASSING_CASE_LIMIT = 5000

/**
 * How often accumulated events reach React. The stream peaks in the thousands
 * of events per second, so rendering per event would starve the UI thread;
 * terminal events flush immediately regardless.
 */
const FLUSH_INTERVAL_MS = 150

/**
 * Events held while a run's id is still unknown. The window is one IPC
 * round trip, but the stream peaks in the thousands of events per second, so
 * it is bounded; the events past the cap are cases, which [`DiagnosticsRun`]
 * caps anyway.
 */
const PENDING_EVENT_LIMIT = 5000

export interface DiagnosticsCase {
  device: string
  family: string
  op: string
  params: string
  status: DiagnosticsCaseStatus
  error?: string
  detail?: string
}

export interface DiagnosticsFamily {
  family: string
  status: DiagnosticsFamilyStatus
  ok: number
  failed: number
  notSupported: number
  millis: number
  exit?: string
  lastLines: string[]
}

export interface DiagnosticsDeviceRun {
  device: DiagnosticsDevice
  families: DiagnosticsFamily[]
  ok: number
  failed: number
  notSupported: number
  crashed: number
  hung: number
  /** Families whose shape filter matched no case, so they tested nothing. */
  noCases: number
  /** Families the run never reached, because it was cancelled or timed out. */
  cancelled: number
  /**
   * Per-op support, keyed by op name. Counted from every case event rather
   * than from `cases`, which is capped -- a long run would otherwise
   * undercount.
   */
  opSupport: Record<string, OpSupport>
  complete: boolean
}

/**
 * How one op fared on one device.
 *
 * Counts, not a boolean: an op is very often *partially* supported. A device
 * reporting some unsupported `MUL_MAT` cases still has a `MUL_MAT` kernel for
 * almost all of them, and listing the bare op name says the opposite.
 */
export interface OpSupport {
  op: string
  /** Cases the device reported it supports, from the support probe. */
  ok: number
  notSupported: number
  /** Parameter strings that had no kernel, for a report to quote. */
  examples: string[]
}

/** Unsupported parameter strings kept per op; enough to show the shape. */
export const EXAMPLES_PER_OP = 4

/** Ops with at least one unsupported case, worst first. */
export function unsupportedOps(device: DiagnosticsDeviceRun): OpSupport[] {
  return Object.values(device.opSupport)
    .filter((o) => o.notSupported > 0)
    .sort((a, b) => b.notSupported - a.notSupported || a.op.localeCompare(b.op))
}

export type DiagnosticsRunStatus =
  | 'idle'
  | 'running'
  | 'passed'
  /**
   * Nothing failed, but at least one family tested nothing. Its own status
   * rather than a pass: a narrowed run that covered none of what it named
   * must not read as "your hardware is fine".
   */
  | 'inconclusive'
  | 'failed'
  | 'cancelled'
  | 'error'

export interface DiagnosticsRun {
  job: string
  status: DiagnosticsRunStatus
  preset: DiagnosticsPreset
  engine?: DiagnosticsEngineBuild
  /** The model this run was built for, on the `model` preset. */
  model?: string
  backendModules: string[]
  devices: DiagnosticsDeviceRun[]
  cases: DiagnosticsCase[]
  /** True when passing cases were dropped at [`PASSING_CASE_LIMIT`]. */
  casesTruncated: boolean
  totalUnits: number
  finishedUnits: number
  current?: { device: string; family: string }
  error?: string
  startedAt: number
  finishedAt?: number
}

function emptyRun(job: string, preset: DiagnosticsPreset): DiagnosticsRun {
  return {
    job,
    status: 'running',
    preset,
    backendModules: [],
    devices: [],
    cases: [],
    casesTruncated: false,
    totalUnits: 0,
    finishedUnits: 0,
    startedAt: Date.now(),
  }
}

function deviceEntry(
  run: DiagnosticsRun,
  name: string
): DiagnosticsDeviceRun | undefined {
  return run.devices.find((d) => d.device.name === name)
}

/**
 * Folds one event into the run. Mutates on purpose: this runs on every case of
 * a stream that peaks in the thousands per second, and the flush below is what
 * hands React a fresh object.
 */
export function applyDiagnosticsEvent(
  run: DiagnosticsRun,
  event: DiagnosticsEvent
): DiagnosticsRun {
  switch (event.event) {
    case 'start':
      run.engine = event.engine
      run.model = event.model
      run.backendModules = event.backend_modules
      run.totalUnits = event.units
      break
    case 'device':
      run.devices.push({
        device: {
          name: event.name,
          description: event.description,
          type: event.type,
          reg: event.reg,
          memory_total_mib: event.memory_total_mib,
          memory_free_mib: event.memory_free_mib,
        },
        families: [],
        ok: 0,
        failed: 0,
        notSupported: 0,
        crashed: 0,
        hung: 0,
        noCases: 0,
        cancelled: 0,
        opSupport: {},
        complete: false,
      })
      break
    case 'family_start':
      run.current = { device: event.device, family: event.family }
      break
    case 'case': {
      const failing = event.status === 'fail'
      if (failing || run.cases.length < PASSING_CASE_LIMIT) {
        run.cases.push({
          device: event.device,
          family: event.family,
          op: event.op,
          params: event.params,
          status: event.status,
          error: event.error,
          detail: event.detail,
        })
      } else {
        run.casesTruncated = true
      }
      // Support comes from the probe alone. It asks the whole op list once,
      // so it is both authoritative and a correct denominator -- whereas the
      // test run re-reports the same ops, and summing the two counted every
      // quick-preset family twice.
      //
      // Counted outside the cap above: `ok` and `not_supported` cases are
      // both non-failing, so a capped run would undercount them.
      if (
        event.mode === 'support' &&
        (event.status === 'ok' || event.status === 'not_supported')
      ) {
        const device = deviceEntry(run, event.device)
        if (device) {
          const stat = (device.opSupport[event.op] ??= {
            op: event.op,
            ok: 0,
            notSupported: 0,
            examples: [],
          })
          if (event.status === 'ok') {
            stat.ok += 1
          } else {
            stat.notSupported += 1
            if (stat.examples.length < EXAMPLES_PER_OP) {
              stat.examples.push(event.params)
            }
          }
        }
      }
      break
    }
    case 'family_end': {
      run.finishedUnits += 1
      run.current = undefined
      const device = deviceEntry(run, event.device)
      if (device) {
        device.families.push({
          family: event.family,
          status: event.status,
          ok: event.ok,
          failed: event.failed,
          notSupported: event.not_supported,
          millis: event.millis,
          exit: event.exit,
          lastLines: event.last_lines ?? [],
        })
      }
      break
    }
    case 'summary': {
      const device = deviceEntry(run, event.device)
      if (device) {
        device.ok = event.ok
        device.failed = event.failed
        device.notSupported = event.not_supported
        device.crashed = event.families_crashed
        device.hung = event.families_hung
        device.noCases = event.families_no_cases ?? 0
        device.cancelled = event.families_cancelled ?? 0
        device.complete = true
      }
      break
    }
    case 'done':
      run.current = undefined
      run.finishedAt = Date.now()
      run.error = event.error
      // `inconclusive` is read before `ok`: an inconclusive run reports
      // `ok: false` so a reader of that field alone cannot mistake it for a
      // pass, and this is what tells it apart from a real failure.
      run.status = event.cancelled
        ? 'cancelled'
        : event.error
          ? 'error'
          : event.inconclusive
            ? 'inconclusive'
            : event.ok
              ? 'passed'
              : 'failed'
      break
  }
  return run
}

/** True once the run can no longer produce events. */
export function isFinished(status: DiagnosticsRunStatus): boolean {
  return status !== 'idle' && status !== 'running'
}

/**
 * Drives one hardware check. One run at a time, enforced in the plugin too, so
 * a second Run press reports rather than racing.
 */
export function useLlamacppDiagnostics() {
  const [run, setRun] = useState<DiagnosticsRun | null>(null)
  const [starting, setStarting] = useState(false)
  // The run is accumulated here and copied into state on a timer; `job` gates
  // events from a superseded run, which can still be in flight.
  const buffer = useRef<DiagnosticsRun | null>(null)
  const job = useRef<string | null>(null)
  const dirty = useRef(false)
  // The backend starts the root, and its event pump, before the reply to
  // `startDiagnostics` reaches the webview, so the first events of a run can
  // arrive while its id is still unknown. They are held here and replayed
  // against the id once it lands; dropping them costs the run its device list
  // or, on a fast failure, its terminal event.
  const pending = useRef<DiagnosticsEvent[]>([])
  const awaitingId = useRef(false)
  // Set once the panel is gone. A start in flight at that moment still gets
  // its id back, and that run has to be cancelled too: it holds the single
  // slot for as long as it runs, with nothing left to stop it.
  const unmounted = useRef(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    const flush = () => {
      if (!dirty.current || !buffer.current) return
      dirty.current = false
      setRun({ ...buffer.current })
    }
    onDiagnosticsEvent((event) => {
      if (!buffer.current || event.job !== job.current) {
        if (awaitingId.current && pending.current.length < PENDING_EVENT_LIMIT) {
          pending.current.push(event)
        }
        return
      }
      applyDiagnosticsEvent(buffer.current, event)
      dirty.current = true
      if (event.event === 'done') flush()
    })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch((e) => console.warn('listen llamacpp-diagnostics failed:', e))

    const timer = setInterval(flush, FLUSH_INTERVAL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
      unlisten?.()
      // A run outlives this panel and cannot be reattached to on a remount,
      // so it would hold the single backend slot -- and every core -- with
      // nothing listening. Leaving the page is a cancel.
      unmounted.current = true
      const id = job.current
      if (id && buffer.current && !isFinished(buffer.current.status)) {
        abandon(id)
      }
    }
  }, [])

  const start = useCallback(
    async (
      preset: DiagnosticsPreset,
      devices: string[] = [],
      model?: string
    ) => {
      setStarting(true)
      pending.current = []
      awaitingId.current = true
      try {
        const started = await startDiagnostics(preset, devices, {}, model)
        // The panel can have gone while this was in flight, in which case the
        // cleanup had no id to cancel and this is the first chance to.
        if (unmounted.current) {
          abandon(started.id)
          return
        }
        job.current = started.id
        buffer.current = emptyRun(started.id, preset)
        // Replayed in arrival order, so the run reads exactly as it would
        // have had the id been known from the first event.
        for (const event of pending.current) {
          if (event.job === started.id) {
            applyDiagnosticsEvent(buffer.current, event)
          }
        }
        setRun({ ...buffer.current })
      } catch (e) {
        job.current = null
        buffer.current = null
        setRun({
          ...emptyRun('', preset),
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
          finishedAt: Date.now(),
        })
      } finally {
        awaitingId.current = false
        pending.current = []
        setStarting(false)
      }
    },
    []
  )

  const cancel = useCallback(async () => {
    if (!job.current) return
    try {
      await cancelDiagnostics(job.current)
    } catch (e) {
      console.warn('cancel llamacpp diagnostics failed:', e)
    }
  }, [])

  return {
    run,
    starting,
    running: run?.status === 'running',
    start,
    cancel,
  }
}

/** Stops a run nothing is listening to any more. */
function abandon(id: string) {
  void cancelDiagnostics(id).catch((e) =>
    console.warn('cancel llamacpp diagnostics failed:', e)
  )
}
