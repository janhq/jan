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
  'MODEL_DOES_NOT_FIT',
  'ENGINE_STOPPED',
  'ENGINE_UNREACHABLE',
  'UNSUPPORTED_CPU',
  'INVALID_ARGUMENT',
  'IO_ERROR',
  'INTERNAL_ERROR',
] as const

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number]

/** Mirrors `LoadDiagnostics` in `tauri-plugin-llamacpp/src/diagnostics.rs`. */
export interface LoadDiagnostics {
  modelFile?: string
  architecture?: string
  quantization?: string
  request: Record<string, string | undefined>
  gpus: {
    name: string
    driverVersion: string
    totalMib: number
    freeMib?: number
  }[]
  backends: string[]
  engine: { version: string; tag: string; commit: string }
  log: string
  logTruncated: boolean
}

export interface EngineError {
  code: EngineErrorCode
  message?: string
  /** Raw engine output. Technical, shown only in a details area. */
  details?: string
  missingLibraries?: string[]
  diagnostics?: LoadDiagnostics
}

const KNOWN_CODES: ReadonlySet<string> = new Set(ENGINE_ERROR_CODES)

type Rec = Record<string, unknown>

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

function readDiagnostics(value: unknown): LoadDiagnostics | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const d = value as Rec
  const engine = (d.engine ?? {}) as Rec
  const request: LoadDiagnostics['request'] = {}
  for (const [key, v] of Object.entries((d.request ?? {}) as Rec)) {
    request[key] = asString(v)
  }
  return {
    modelFile: asString(d.model_file),
    architecture: asString(d.architecture),
    quantization: asString(d.quantization),
    request,
    gpus: (Array.isArray(d.gpus) ? (d.gpus as Rec[]) : []).map((g) => ({
      name: asString(g.name) ?? '',
      driverVersion: asString(g.driver_version) ?? '',
      totalMib: asNumber(g.total_mib) ?? 0,
      freeMib: asNumber(g.free_mib),
    })),
    backends: asStrings(d.backends),
    engine: {
      version: asString(engine.version) ?? '',
      tag: asString(engine.tag) ?? '',
      commit: asString(engine.commit) ?? '',
    },
    log: asString(d.log) ?? '',
    logTruncated: d.log_truncated === true,
  }
}

function readEngineErrorObject(value: unknown): EngineError | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const record = value as {
    code?: unknown
    message?: unknown
    details?: unknown
    missing_libraries?: unknown
    diagnostics?: unknown
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
    ...(record.diagnostics
      ? { diagnostics: readDiagnostics(record.diagnostics) }
      : {}),
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

/** Escapes a literal for use inside a regular expression. */
function quoteRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces the user's home directory wherever a path shows up, so a pasted
 * report does not name them. The engine logs full model and library paths,
 * which is where these come from.
 *
 * `home` is the real directory, from [`localHomeDir`](./localHome), and when
 * it is known this is an exact replacement with nothing to get wrong. Pass it
 * wherever it can be had.
 *
 * The fallback is a guess at the *shape* of a path, and it deliberately stops
 * the name at whitespace. A profile folder may well contain a space, but no
 * rule over the text alone separates `/home/Jo Smith/lib` from
 * `/home/bob and models/x.gguf`: three attempts at spanning the space each
 * ended up swallowing the prose between two paths instead. Under-stripping a
 * surname is the lesser harm only because the exact pass above is what
 * actually covers the user's own home on the desktop, which is the only place
 * these reports are produced.
 */
export function stripLocalPaths(text: string, home?: string | null): string {
  let out = text
  if (home) {
    const trimmed = home.replace(/[/\\]+$/, '')
    if (trimmed) {
      // Both separators: a Windows path reaches the report either way.
      const variants = [trimmed, trimmed.replace(/\//g, '\\'), trimmed.replace(/\\/g, '/')]
      for (const variant of new Set(variants)) {
        out = out.replace(new RegExp(quoteRegExp(variant), 'gi'), '~')
      }
    }
  }
  return out
    .replace(/\/(?:home|Users)\/[^/\s"'`:;,)]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`:;,)]+/g, '~')
}

const FENCE = '```'

const fence = (text: string): string =>
  `${FENCE}\n${text.split(FENCE).join("'''")}\n${FENCE}`

/**
 * A markdown report of a failed engine load, for pasting into an issue. Local
 * only: it is built from the error already in memory and handed to the caller
 * to put on the clipboard. Undefined when the error carries no diagnostics.
 */
export function formatLoadDiagnostics(
  error: unknown,
  context: { appVersion?: string; os?: string; home?: string | null } = {}
): string | undefined {
  const engineError = parseEngineError(error)
  const d = engineError?.diagnostics
  if (!engineError || !d) return undefined

  const rows: [string, string | undefined][] = [
    ['Error', engineError.code],
    ['Jan', context.appVersion],
    ['OS', context.os],
    [
      'llama.cpp',
      `${d.engine.version} (${d.engine.tag}, ${d.engine.commit.slice(0, 12)})`,
    ],
    ['Model file', d.modelFile],
    ['Architecture', d.architecture],
    ['Quantization', d.quantization],
    ...Object.entries(d.request),
  ]
  const lines = ['## Model load failure', '']
  for (const [key, value] of rows) {
    if (value) lines.push(`- ${key}: ${value}`)
  }
  if (d.gpus.length) {
    lines.push('', '### Devices')
    for (const g of d.gpus) {
      const free = g.freeMib === undefined ? '' : `, ${g.freeMib} MiB free`
      lines.push(
        `- ${g.name} (driver ${g.driverVersion || 'unknown'}, ${g.totalMib} MiB${free})`
      )
    }
  }
  if (d.backends.length) {
    lines.push('', '### Backend modules', ...d.backends.map((b) => `- ${b}`))
  }
  if (engineError.details) {
    lines.push('', '### Engine message', fence(engineError.details))
  }
  if (d.log) {
    lines.push(
      '',
      d.logTruncated ? '### Engine log (older lines dropped)' : '### Engine log',
      fence(d.log)
    )
  }
  return stripLocalPaths(lines.join('\n'), context.home)
}
