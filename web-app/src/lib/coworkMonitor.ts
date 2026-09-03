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
 * sends -- and keeps the run alive while a watcher is still owed work.
 */

export const MONITOR_TOOL_NAME = 'monitor'

/** Wording ported from `monitor_tool_schema` in Rust; the two surfaces must
 * advertise the same contract. */
export function monitorTool(): Tool {
  return {
    description:
      'Watch a file a long-running job streams output into (e.g. a backgrounded bash job redirecting to a log) and evaluate condition scripts against it. Each condition is a shell script run from the project root whenever the file changes; exit 0 means the condition matched and its stdout is the matched content. You get a <SYSTEM> note per match, so start the monitor and keep working. The monitor stops when every condition has matched, on stop, or at its timeout. A met condition is never re-checked.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['start', 'stop', 'list'] },
        file: {
          type: 'string',
          description:
            'For start: the file to watch, relative to the project root (or under /tmp). It may not exist yet.',
        },
        conditions: {
          type: 'array',
          description:
            "For start: the conditions to watch for. Scripts should be cheap checks (e.g. grep -m1 'BUILD FAILED' build.log), not jobs.",
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description:
                  'Short unique label, quoted back to you when it matches.',
              },
              script: {
                type: 'string',
                description:
                  'Shell script; exit 0 = matched, stdout = the matched content.',
              },
            },
            required: ['name', 'script'],
          },
        },
        timeout: {
          type: 'integer',
          description:
            'For start: seconds before the monitor gives up and reports its unmet conditions (default 1800, max 7200).',
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
export type MonitorSpec = { file: string; conditions: string[] }

/** The watched file and condition names out of a `start` call's arguments. */
export function monitorSpecFromArgs(input: unknown): MonitorSpec {
  const args =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const file = typeof args.file === 'string' ? args.file : ''
  const conditions = Array.isArray(args.conditions)
    ? args.conditions.flatMap((c) => {
        const name =
          c && typeof c === 'object' ? (c as { name?: unknown }).name : null
        return typeof name === 'string' ? [name] : []
      })
    : []
  return { file, conditions }
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
 * What the run's inbox needs to hear about monitors. Structurally what
 * `SubagentInbox` provides, so the two kinds of background work share one
 * inbox and one park/resume path.
 */
export type MonitorInbox = {
  begin: () => void
  finish: (notice: SubagentNotice) => void
  note: (notice: SubagentNotice) => void
  abandon: () => void
}

/**
 * One run's view of its monitors, bridging Rust updates to the inbox.
 *
 * The open-set exists because the inbox's running count is shared with the
 * subagents: `finish`/`abandon` must fire exactly once per started monitor, and
 * a stop racing the monitor's own terminal update would otherwise decrement
 * twice -- reading `pending()` false while a subagent is still running.
 */
export class MonitorLane {
  private open = new Set<string>()

  constructor(
    private readonly inbox: MonitorInbox,
    private readonly view?: MonitorViewSink
  ) {}

  /** Record a successful start (its result names the id) and claim a running
   * slot, so the run parks on the watcher instead of ending under it. */
  started(startResult: string, spec?: MonitorSpec): void {
    const id = parseMonitorId(startResult)
    if (!id) return
    this.open.add(id)
    this.inbox.begin()
    this.view?.started({
      monitorId: id,
      file: spec?.file ?? '',
      met: [],
      unmet: spec?.conditions ?? [],
      status: 'running',
      startedAt: Date.now(),
    })
  }

  /** Route one Rust update: a terminal one closes the slot, any other is a
   * ping the model reacts to while the watcher keeps going. */
  update(update: MonitorUpdate): void {
    this.view?.updated(update)
    const notice: SubagentNotice = {
      headline: update.headline,
      text: update.text,
    }
    if (update.done && this.open.delete(update.monitorId)) {
      this.inbox.finish(notice)
      return
    }
    this.inbox.note(notice)
  }

  /** Account for an explicit `stop`: the slot is released with no ping, since
   * the model's own tool result already reports the outcome. */
  stopped(monitorId: string, stopResult: string): void {
    if (!stopResult.startsWith('ERROR') && this.open.delete(monitorId)) {
      this.inbox.abandon()
      this.view?.stopped(monitorId)
    }
  }
}
