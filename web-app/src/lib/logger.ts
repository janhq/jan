import { invoke } from '@tauri-apps/api/core'

const META_DELIMITER = ' |META|'

function serializeMeta(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta)
  } catch {
    return JSON.stringify({ error: 'Failed to serialize meta' })
  }
}

/**
 * Parse V8-style stack trace to extract the true caller location.
 * Skips this helper, the log wrapper, and the plugin-log internal frames.
 */
function getCallerLocation(): string | undefined {
  const stack = new Error().stack
  if (!stack) return undefined
  const lines = stack.split('\n')
  // lines[0] = Error
  // lines[1] = getCallerLocation
  // lines[2] = logError / logWarn / logInfo
  // lines[3] = actual caller
  const callerLine = lines[3]?.trim()
  if (!callerLine) return undefined

  const match = callerLine.match(
    /at\s+(?<functionName>.*?)\s+\((?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)\)/
  )
  if (match?.groups) {
    const { functionName, fileName, lineNumber, columnNumber } = match.groups
    return `${functionName}@${fileName}:${lineNumber}:${columnNumber}`
  }

  const matchNoFn = callerLine.match(
    /at\s+(?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)/
  )
  if (matchNoFn?.groups) {
    const { fileName, lineNumber, columnNumber } = matchNoFn.groups
    return `<anonymous>@${fileName}:${lineNumber}:${columnNumber}`
  }

  return undefined
}

function inferTarget(): string {
  const loc = getCallerLocation()
  if (!loc) return 'frontend/unknown'
  const filePart = loc.split('@')[1] || ''
  if (filePart.includes('/hub/')) return 'frontend/hub'
  if (filePart.includes('/marketplace/')) return 'frontend/marketplace'
  if (filePart.includes('/local-models/')) return 'frontend/local-models'
  if (filePart.includes('/openclaw/')) return 'frontend/openclaw'
  if (filePart.includes('/routes/')) return 'frontend/routes'
  if (filePart.includes('/hooks/')) return 'frontend/hooks'
  if (filePart.includes('/lib/')) return 'frontend/lib'
  if (filePart.includes('/components/')) return 'frontend/components'
  return 'frontend/unknown'
}

function logWithCaller(
  level: number,
  msg: string,
  meta?: Record<string, unknown>
): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  invoke('plugin:log|log', {
    level,
    message: payload,
    location: getCallerLocation(),
    file: undefined,
    line: undefined,
    keyValues: { target: inferTarget() },
  }).catch(() => {
    const method = level === 5 ? 'error' : level === 4 ? 'warn' : 'info'
    // eslint-disable-next-line no-console
    console[method](`[log${method.charAt(0).toUpperCase() + method.slice(1)}]`, payload)
  })
}

export function logError(msg: string, meta?: Record<string, unknown>): void {
  logWithCaller(5, msg, meta)
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  logWithCaller(4, msg, meta)
}

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  logWithCaller(3, msg, meta)
}
