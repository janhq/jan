/**
 * Shared logger for extensions.
 *
 * Emits through the standard `console` methods; the web-app installs a
 * console interceptor that forwards these to `app.log` via the Tauri log
 * plugin with matching levels. Extensions must not call the log plugin
 * directly or lines would be duplicated in `app.log`.
 * @module
 */

export function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ? `${arg.message}\n${arg.stack}` : arg.message
  }
  if (arg === null || arg === undefined) return String(arg)
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg)
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export const logger: Logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}
