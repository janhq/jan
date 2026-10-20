import { i18n } from '@/i18n/react-i18next-compat'

/**
 * Mirrors `ErrorCode` in `tauri-plugin-llamacpp/src/error.rs`. The Rust side has
 * a test pinning these exact strings, since they cross the IPC boundary as the
 * contract this file matches on.
 */
export const ENGINE_ERROR_CODES = [
  'MODEL_LOAD_FAILED',
  'MODEL_ARCH_NOT_SUPPORTED',
  'MODEL_LOAD_TIMED_OUT',
  'MISSING_SHARED_LIBRARY',
  'GPU_DRIVER_TOO_OLD',
  'OUT_OF_MEMORY',
  'INVALID_ARGUMENT',
  'IO_ERROR',
  'INTERNAL_ERROR',
] as const

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number]

export interface EngineError {
  code: EngineErrorCode
  message?: string
  /** Raw engine output. Technical, shown only in a details area. */
  details?: string
  missingLibraries?: string[]
}

const KNOWN_CODES: ReadonlySet<string> = new Set(ENGINE_ERROR_CODES)

function readEngineErrorObject(value: unknown): EngineError | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const record = value as {
    code?: unknown
    message?: unknown
    details?: unknown
    missing_libraries?: unknown
  }
  if (typeof record.code !== 'string' || !KNOWN_CODES.has(record.code)) {
    return undefined
  }

  const missingLibraries = Array.isArray(record.missing_libraries)
    ? record.missing_libraries.filter(
        (lib): lib is string => typeof lib === 'string'
      )
    : undefined

  return {
    code: record.code as EngineErrorCode,
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
    ...(typeof record.details === 'string' ? { details: record.details } : {}),
    ...(missingLibraries?.length ? { missingLibraries } : {}),
  }
}

/** `Error.cause` is es2022; the app's lib target predates it. */
function causeOf(error: unknown): unknown {
  return error instanceof Error
    ? (error as Error & { cause?: unknown }).cause
    : undefined
}

/** Depth of `cause` chaining to follow; two wrappers is the deepest real case. */
const MAX_CAUSE_DEPTH = 4

/**
 * Recovers a structured engine error, including one that an intermediate layer
 * already stringified into an Error message or carried along as a `cause`.
 */
export function parseEngineError(
  error: unknown,
  depth = MAX_CAUSE_DEPTH
): EngineError | undefined {
  const direct = readEngineErrorObject(error)
  if (direct) return direct

  const cause = depth > 0 ? causeOf(error) : undefined
  if (cause !== undefined) {
    const fromCause = parseEngineError(cause, depth - 1)
    if (fromCause) return fromCause
  }

  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined
  if (!text) return undefined

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined

  try {
    return readEngineErrorObject(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return undefined
  }
}

/** Enough of the engine's output to name a cause, short enough for a toast. */
const MAX_DETAIL_LENGTH = 240

/**
 * The engine's own words on one line. Untranslatable by nature, and the only
 * part that distinguishes one load failure from another, so it rides along
 * with the localized advice instead of being dropped.
 */
function engineDetail(engineError: EngineError): string | undefined {
  const raw = engineError.details?.replace(/\s+/g, ' ').trim()
  if (!raw) return undefined
  return raw.length > MAX_DETAIL_LENGTH
    ? `${raw.slice(0, MAX_DETAIL_LENGTH).trimEnd()}...`
    : raw
}

/**
 * A localized, user-facing description of an engine failure. Replaces the raw
 * English the Rust layer produces, and the raw JSON a serialized error used to
 * turn into when it reached a template expecting an Error.
 */
export function describeEngineError(error: unknown): string {
  const engineError = parseEngineError(error)

  if (engineError) {
    const parts = [i18n.t(`model-errors:engine.${engineError.code}`)]
    if (engineError.missingLibraries?.length) {
      parts.push(
        i18n.t('model-errors:engineMissingLibraries', {
          libraries: engineError.missingLibraries.join(', '),
        })
      )
    }
    const detail = engineDetail(engineError)
    if (detail) {
      parts.push(i18n.t('model-errors:engineReportedDetail', { detail }))
    }
    return parts.join(' ')
  }

  const fallback =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  return fallback.trim() || i18n.t('model-errors:engine.unknown')
}

/**
 * A localized wrapper that keeps the structured engine error reachable through
 * `cause`. An outer layer then describes the failure from its code once,
 * instead of nesting one localized sentence inside another.
 */
export function engineFailure(messageKey: string, error: unknown): Error {
  const wrapped = new Error(
    i18n.t(messageKey, { reason: describeEngineError(error) })
  ) as Error & { cause?: unknown }
  wrapped.cause = error
  return wrapped
}
