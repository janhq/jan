import {
  debug as logDebug,
  error as logError,
  info as logInfo,
  warn as logWarn,
} from '@tauri-apps/plugin-log'
import { formatLogArg } from '@janhq/core'

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

let installed = false

/**
 * Forward web-app console output to app.log via @tauri-apps/plugin-log.
 * Release builds forward warn/error/info; debug builds also forward debug/log.
 * No-op outside Tauri (dev:web) and safe to call more than once.
 */
export function installConsoleLogForwarding(): void {
  if (installed) return
  if (!('__TAURI_INTERNALS__' in window)) return
  installed = true

  const forwardVerbose = import.meta.env.DEV

  const forward = (
    sink: (message: string) => Promise<void>,
    args: unknown[]
  ) => {
    void sink(args.map(formatLogArg).join(' ')).catch(() => {})
  }

  const patch = (
    method: ConsoleMethod,
    sink: (message: string) => Promise<void>
  ) => {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      original(...args)
      forward(sink, args)
    }
  }

  patch('error', logError)
  patch('warn', logWarn)
  patch('info', logInfo)

  if (forwardVerbose) {
    patch('log', logDebug)
    patch('debug', logDebug)
  }
}
