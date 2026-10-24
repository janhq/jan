import type { AppSettingsBackend } from './settings-store'

/** How often the host pings a running worker. */
export const PING_INTERVAL_MS = 5_000
/** Unanswered pings after which a worker counts as hung. */
export const MAX_MISSED_PONGS = 3
/** Crashes within CRASH_WINDOW_MS that disable an extension for the session. */
export const CRASH_LIMIT = 3
export const CRASH_WINDOW_MS = 10 * 60_000

export interface Heartbeat {
  /** Records the worker's answer to ping `n`. */
  pong(n: number): void
  dispose(): void
}

/**
 * Pings a worker every PING_INTERVAL_MS. A worker stuck in a busy loop
 * cannot answer, and no other limit sees it: it sends nothing. Once
 * MAX_MISSED_PONGS pings in a row went unanswered, `onDead` runs once and
 * the heartbeat stops.
 */
export function startHeartbeat(options: {
  ping(n: number): void
  onDead(): void
}): Heartbeat {
  let sent = 0
  let answered = 0
  const timer = setInterval(() => {
    if (sent - answered >= MAX_MISSED_PONGS) {
      clearInterval(timer)
      options.onDead()
      return
    }
    sent += 1
    options.ping(sent)
  }, PING_INTERVAL_MS)
  return {
    pong: (n) => {
      // Only an answer to a ping actually sent counts; a worker cannot
      // stay alive by sending pongs ahead of time.
      if (n > answered && n <= sent) answered = n
    },
    dispose: () => clearInterval(timer),
  }
}

/**
 * Counts crashes per extension; true when one reaches CRASH_LIMIT within
 * CRASH_WINDOW_MS.
 */
export function crashCounter(
  now: () => number = Date.now
): (extensionId: string) => boolean {
  const crashes = new Map<string, number[]>()
  return (extensionId) => {
    const t = now()
    const recent = (crashes.get(extensionId) ?? []).filter(
      (at) => t - at <= CRASH_WINDOW_MS
    )
    recent.push(t)
    crashes.set(extensionId, recent)
    return recent.length >= CRASH_LIMIT
  }
}

/** App starts in a row that did not get the installed extensions loaded. */
export const FAILED_STARTS_KEY = 'extension-host:failedStarts'
export const MAX_FAILED_STARTS = 2

/**
 * Loads the installed extensions with a crash-loop guard. A start counts as
 * failed until `load` settled, so an extension that crashes or hangs the
 * app while loading leaves the counter up. After MAX_FAILED_STARTS such
 * starts in a row, safe mode is turned on before anything loads, and
 * `onSafeMode` tells the user. The counter lives in the app settings,
 * which survive a crash of the window.
 */
export async function loadWithCrashLoopGuard(options: {
  settings: AppSettingsBackend
  setSafeMode(on: boolean): Promise<void>
  onSafeMode(): void
  load(): Promise<void>
}): Promise<void> {
  const { settings } = options
  const failed = Number.parseInt((await settings.get(FAILED_STARTS_KEY)) ?? '', 10)
  const failedStarts = Number.isSafeInteger(failed) && failed > 0 ? failed : 0
  if (failedStarts >= MAX_FAILED_STARTS) {
    await options.setSafeMode(true)
    options.onSafeMode()
  }
  await settings.set(FAILED_STARTS_KEY, String(failedStarts + 1))
  try {
    await options.load()
  } finally {
    await settings.set(FAILED_STARTS_KEY, '0')
  }
}
