import { error, warn, info } from '@tauri-apps/plugin-log'

const META_DELIMITER = ' |META|'

function serializeMeta(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta)
  } catch {
    return JSON.stringify({ error: 'Failed to serialize meta' })
  }
}

export function logError(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  error(payload)
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  warn(payload)
}

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  const payload = meta
    ? `${msg}${META_DELIMITER}${serializeMeta(meta)}`
    : msg
  info(payload)
}
