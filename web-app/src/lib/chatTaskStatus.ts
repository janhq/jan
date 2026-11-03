/**
 * `data-task-status` rows are DISPLAY-ONLY: the model never sees them
 * (convertToModelMessages drops data parts). The `task` tool output is receipt
 * prose only and does NOT keep the child's output; the model's copy comes from
 * the model-visible run-context ping. These rows therefore get an optional
 * budget of their own in the persisted carrier: shaped and validated per row,
 * and shed before anything model-visible (run-context pings, canonical parts)
 * is ever given up.
 * Shared by chatOrchestration (live bound) and messages (carrier); only the
 * shared truncateUtf16 helper is imported.
 */
import { truncateUtf16 } from './truncateUtf16'

/** Live bound per `finalOutput` / `error` (UTF-16 code units, marker included). */
export const TASK_STATUS_TEXT_LIMIT = 100_000
export const TASK_STATUS_TRUNCATION_MARKER = '\n\n[truncated: output exceeded 100000 characters]'

/** What a row keeps of `finalOutput` / `error` when the carrier is over budget. */
export const TASK_STATUS_CARRIER_TEXT_LIMIT = 4_000
export const TASK_STATUS_CARRIER_MARKER = '\n\n[truncated for storage: carrier size budget]'

/** Upper bounds that keep one status part's identity fields small. */
export const TASK_STATUS_MAX_ROWS_PER_PART = 16
export const TASK_STATUS_MAX_ID_CHARS = 256

const ROW_KEYS = new Set(['runId', 'name', 'status', 'startedAt', 'endedAt', 'finalOutput', 'error'])
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBoundedId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= TASK_STATUS_MAX_ID_CHARS

function shapeRow(row: unknown): Record<string, unknown> | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined
  const r = row as Record<string, unknown>
  for (const key of Object.keys(r)) if (r[key] !== undefined && !ROW_KEYS.has(key)) return undefined
  if (!isBoundedId(r.runId) || !isBoundedId(r.name)) return undefined
  if (r.status !== 'running' && r.status !== 'done' && r.status !== 'error') return undefined
  if (!isFiniteNumber(r.startedAt)) return undefined
  if (r.endedAt !== undefined && !isFiniteNumber(r.endedAt)) return undefined
  for (const key of ['finalOutput', 'error'] as const)
    if (r[key] !== undefined && typeof r[key] !== 'string') return undefined
  const out: Record<string, unknown> = {
    runId: r.runId, name: r.name, status: r.status, startedAt: r.startedAt,
  }
  if (r.endedAt !== undefined) out.endedAt = r.endedAt
  for (const key of ['finalOutput', 'error'] as const)
    if (r[key] !== undefined)
      out[key] = truncateUtf16(r[key] as string, TASK_STATUS_TEXT_LIMIT, TASK_STATUS_TRUNCATION_MARKER)
  return out
}

/**
 * The part with its rows shaped (allowlisted keys, bounded ids, finite
 * timestamps, text within the live bound), or `undefined` when it is not a
 * well-formed status part. Display-only, so the caller omits and counts a
 * malformed one rather than losing the carrier over it.
 */
export function shapeTaskStatusPart(part: unknown): Record<string, unknown> | undefined {
  if (!part || typeof part !== 'object') return undefined
  const p = part as Record<string, unknown>
  for (const key of Object.keys(p))
    if (p[key] !== undefined && key !== 'type' && key !== 'id' && key !== 'data') return undefined
  if (typeof p.id !== 'string' || !p.id) return undefined
  const data = p.data as Record<string, unknown> | null | undefined
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  if (Object.keys(data).some((k) => k !== 'subagents')) return undefined
  const rows = data.subagents
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > TASK_STATUS_MAX_ROWS_PER_PART)
    return undefined
  const shaped = rows.map(shapeRow)
  if (shaped.some((row) => !row)) return undefined
  return { type: p.type, id: p.id, data: { subagents: shaped } }
}

const hasBulk = (row: Record<string, unknown>) =>
  row.finalOutput !== undefined || row.error !== undefined

const rowsOf = (part: Record<string, unknown>) =>
  (part.data as { subagents: Record<string, unknown>[] }).subagents

/** The part's bulky text cut to the carrier limit (status, ids and timestamps kept). */
export function truncateTaskStatusPart(part: Record<string, unknown>): Record<string, unknown> {
  const cut = (row: Record<string, unknown>) => {
    const out = { ...row }
    for (const key of ['finalOutput', 'error'] as const)
      if (typeof out[key] === 'string')
        out[key] = truncateUtf16(out[key] as string, TASK_STATUS_CARRIER_TEXT_LIMIT, TASK_STATUS_CARRIER_MARKER)
    return out
  }
  return { ...part, data: { subagents: rowsOf(part).map(cut) } }
}

/** The part without any `finalOutput` / `error` (status, ids and timestamps kept). */
export function stripTaskStatusPart(part: Record<string, unknown>): Record<string, unknown> {
  const strip = (row: Record<string, unknown>) => {
    const rest = { ...row }
    delete rest.finalOutput
    delete rest.error
    return rest
  }
  return { ...part, data: { subagents: rowsOf(part).map(strip) } }
}

export const taskStatusHasBulk = (part: Record<string, unknown>): boolean =>
  rowsOf(part).some(hasBulk)
