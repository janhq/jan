import { jsonSchema, type Tool } from 'ai'
import type { MonitorUpdate } from '@/lib/agentTools'
import type { SubagentNotice } from '@/lib/coworkSubagent'
import type { MonitorView } from '@/types/coworkSession'

/**
 * The `monitor` tool on the Cowork surface.
 *
 * The watcher itself runs in Rust (`tools/monitor.rs`, reached through the
 * plugin's guest-js): it tails the file, evaluates the condition scripts under
 * the same OS sandbox `bash` gets, and streams every match back as a
 * `MonitorUpdate`. What lives here is the client half: the transcribed schema
 * (like `task`/`todo`), and the bookkeeping that turns updates into inbox pings
 * so a match reaches the model as the same `<SYSTEM>` note a finished subagent
 * sends, whether a run is up to drain it or one has to be started for it.
 */

export const MONITOR_TOOL_NAME = 'monitor'

/** Wording ported from `monitor_tool_schema` in Rust; the two surfaces must
 * advertise the same contract. */
export function monitorTool(): Tool {
  return {
    description:
      'Wait for something in the background: poll a shell script on an interval until it exits 0, then get its stdout as a <SYSTEM> note while you keep working. Use it to wait on a backgrounded job, e.g. script "grep -m1 \'BUILD FAILED\' build.log" or "test -f done.flag". The script runs from the project root on every poll; a nonzero exit means not yet. The first match ends the monitor, as does its timeout. Start one monitor per thing you are waiting for.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['start', 'stop', 'list'] },
        script: {
          type: 'string',
          description:
            'For start: a cheap shell check that exits 0 once the thing has happened; its stdout is what you get back.',
        },
        name: {
          type: 'string',
          description:
            'For start: optional short label quoted back to you when it matches (defaults to the script).',
        },
        interval: {
          type: 'integer',
          description:
            'For start: seconds between polls (default 5, min 1, max 300).',
        },
        timeout: {
          type: 'integer',
          description:
            'For start: seconds before the monitor gives up (default 1800, max 7200).',
        },
        monitor_id: {
          type: 'string',
          description: 'For stop: the id returned by start.',
        },
      },
      required: ['op'],
    }),
  } as Tool
}

/** The id a successful start result names (`monitor_id=mon-N`), or null. */
export function parseMonitorId(startResult: string): string | null {
  const match = startResult.match(/monitor_id=([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

/** What a `start` call asked for, as the panel shows it before any update. */
export type MonitorSpec = { name: string; script: string }

/** The name and script out of a `start` call's arguments. The name falls back
 * to the script, as Rust's parser does. */
export function monitorSpecFromArgs(input: unknown): MonitorSpec {
  const args =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const script = typeof args.script === 'string' ? args.script.trim() : ''
  const name =
    typeof args.name === 'string' && args.name.trim()
      ? args.name.trim()
      : script
  return { name, script }
}

/**
 * The display's view of the run's monitors: opened on a successful start,
 * advanced by every update, closed by an explicit stop. Optional, since a
 * headless run has no panel to feed.
 */
export type MonitorViewSink = {
  started: (view: MonitorView) => void
  updated: (update: MonitorUpdate) => void
  stopped: (monitorId: string) => void
}

/**
 * One session's monitors, outliving any single run.
 *
 * A watcher does not hold a run open: the model answers, the run ends and the
 * user keeps talking. Matches queue here as the same `<SYSTEM>` pings a
 * finished subagent sends. A running loop drains them at the top of its next
 * step; while no run is up, `onPing` lets the route start one. The open-set is
 * display bookkeeping only (`watching`, the rail's view).
 */
export class MonitorLane {
  private open = new Set<string>()
  private queue: SubagentNotice[] = []
  private waiters: Array<() => void> = []
  /** Fired on every queued ping, so an idle session can start a turn for it. */
  onPing: (() => void) | null = null

  constructor(private readonly view?: MonitorViewSink) {}

  /** Record a successful start (its result names the id). */
  started(startResult: string, spec?: MonitorSpec): void {
    const id = parseMonitorId(startResult)
    if (!id) return
    this.open.add(id)
    this.view?.started({
      monitorId: id,
      name: spec?.name ?? '',
      script: spec?.script ?? '',
      status: 'running',
      startedAt: Date.now(),
    })
  }

  /** Route one Rust update: shown in the rail, queued for the model. Every
   * update ends its monitor (a match or the timeout). */
  update(update: MonitorUpdate): void {
    this.view?.updated(update)
    this.open.delete(update.monitorId)
    this.queue.push({ headline: update.headline, text: update.text })
    this.wake()
    this.onPing?.()
  }

  /** Account for an explicit `stop`. No ping: the model's own tool result
   * already reports the outcome. */
  stopped(monitorId: string, stopResult: string): void {
    if (!stopResult.startsWith('ERROR') && this.open.delete(monitorId)) {
      this.view?.stopped(monitorId)
    }
  }

  /** Monitors still running. */
  watching(): number {
    return this.open.size
  }

  hasQueued(): boolean {
    return this.queue.length > 0
  }

  /** Take every queued ping, oldest first. */
  take(): SubagentNotice[] {
    const out = this.queue
    this.queue = []
    return out
  }

  /** Resolve when a ping is queued or the run waiting on it is cancelled. */
  wait(signal?: AbortSignal): Promise<void> {
    if (this.hasQueued() || signal?.aborted) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = () => {
        signal?.removeEventListener('abort', done)
        resolve()
      }
      this.waiters.push(done)
      signal?.addEventListener('abort', done, { once: true })
    })
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }
}

const lanes = new Map<string, MonitorLane>()

/** The session's lane, created on first use with `view` when given. */
export function monitorLaneFor(
  sessionId: string,
  view?: () => MonitorViewSink
): MonitorLane {
  let lane = lanes.get(sessionId)
  if (!lane) {
    lane = new MonitorLane(view?.())
    lanes.set(sessionId, lane)
  }
  return lane
}

/** Forget a session's lane; its Rust watchers are stopped separately. */
export function dropMonitorLane(sessionId: string): void {
  lanes.delete(sessionId)
}
