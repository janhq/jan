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
 * Uptime after the installed extensions loaded before a start counts as
 * good. An extension can send `ready` and take the window down a few
 * seconds later (a worker exhausting memory shares the renderer), so the
 * end of loading alone proves nothing.
 */
export const START_GRACE_MS = 60_000

/**
 * Loads the installed extensions with a crash-loop guard. Each start raises
 * a persistent counter first; it goes back to 0 only once the app ran for
 * START_GRACE_MS after loading settled, or when the window is closed
 * cleanly (`onCleanShutdown`, e.g. quitting, a reload or an updater
 * restart) - never just because loading finished. So a start counts as
 * failed exactly when the window died or was killed early. A worker cannot
 * fake a clean shutdown: it has no way to close the window.
 *
 * After MAX_FAILED_STARTS failed starts in a row, safe mode is turned on
 * before anything loads and `onSafeMode` tells the user. If turning it on
 * fails, the installed extensions are still not loaded this start, and
 * `onSafeModeFailed` tells the user; the counter stays up, so the next
 * start tries again. The counter lives in the app settings, which survive
 * a crash of the window. The clean-shutdown reset is best effort: if its
 * write does not land before the window goes, that start counts once.
 */
export async function loadWithCrashLoopGuard(options: {
  settings: AppSettingsBackend
  setSafeMode(on: boolean): Promise<void>
  onSafeMode(): void
  onSafeModeFailed(error: unknown): void
  /** Registers `reset` to run when the window closes cleanly. */
  onCleanShutdown(reset: () => void): void
  load(): Promise<void>
}): Promise<void> {
  const { settings } = options
  const failed = Number.parseInt((await settings.get(FAILED_STARTS_KEY)) ?? '', 10)
  const failedStarts = Number.isSafeInteger(failed) && failed > 0 ? failed : 0
  await settings.set(FAILED_STARTS_KEY, String(failedStarts + 1))
  let good = false
  const reset = () => {
    if (good) return
    good = true
    void settings.set(FAILED_STARTS_KEY, '0').catch(() => undefined)
  }
  options.onCleanShutdown(reset)
  if (failedStarts >= MAX_FAILED_STARTS) {
    try {
      await options.setSafeMode(true)
    } catch (error) {
      options.onSafeModeFailed(error)
      return
    }
    options.onSafeMode()
  }
  try {
    await options.load()
  } finally {
    setTimeout(reset, START_GRACE_MS)
  }
}
