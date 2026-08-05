import { i18n } from '@/i18n/react-i18next-compat'

/**
 * Mirrors `ErrorCode` in `tauri-plugin-llamacpp/src/error.rs`. The Rust side has
 * a test pinning these exact strings, since they cross the IPC boundary as the
 * contract this file matches on.
 */
export const ENGINE_ERROR_CODES = [
  'BINARY_NOT_FOUND',
  'MODEL_FILE_NOT_FOUND',
  'LIBRARY_PATH_INVALID',
  'MODEL_LOAD_FAILED',
  'DRAFT_MODEL_LOAD_FAILED',
  'MULTIMODAL_PROJECTOR_LOAD_FAILED',
  'MODEL_ARCH_NOT_SUPPORTED',
  'MODEL_LOAD_TIMED_OUT',
  'LLAMA_CPP_PROCESS_ERROR',
  'MISSING_SHARED_LIBRARY',
  'GPU_DRIVER_TOO_OLD',
  'OUT_OF_MEMORY',
  'INVALID_ARGUMENT',
  'DEVICE_LIST_PARSE_FAILED',
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

/**
 * Recovers a structured engine error, including one that an intermediate layer
 * already stringified into an Error message.
 */
export function parseEngineError(error: unknown): EngineError | undefined {
  const direct = readEngineErrorObject(error)
  if (direct) return direct

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

/**
 * A localized, user-facing description of an engine failure. Replaces the raw
 * English the Rust layer produces, and the raw JSON a serialized error used to
 * turn into when it reached a template expecting an Error.
 */
export function describeEngineError(error: unknown): string {
  const engineError = parseEngineError(error)

  if (engineError) {
    const description = i18n.t(`model-errors:engine.${engineError.code}`)
    if (engineError.missingLibraries?.length) {
      return `${description} ${i18n.t('model-errors:engineMissingLibraries', {
        libraries: engineError.missingLibraries.join(', '),
      })}`
    }
    return description
  }

  const fallback =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  return fallback.trim() || i18n.t('model-errors:engine.unknown')
}
