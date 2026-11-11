/**
 * Custom request headers a user attaches to a remote provider.
 *
 * The settings page edits them as free-form rows; everything that sends a
 * request (model-factory, model listing, the local API server registration)
 * reads `provider.custom_header`. These helpers keep what gets stored valid:
 * a header name that `fetch` rejects would otherwise break every request to
 * the provider.
 */

export type CustomHeaderRow = {
  header: string
  value: string
}

// RFC 9110 token: the characters `fetch` accepts in a header name.
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function isValidHeaderName(name: string): boolean {
  return HEADER_NAME_PATTERN.test(name)
}

/** A header value may not contain line breaks; anything else is passed as-is. */
export function isValidHeaderValue(value: string): boolean {
  return !/[\r\n]/.test(value)
}

export function emptyCustomHeaderRow(): CustomHeaderRow {
  return { header: '', value: '' }
}

/**
 * Turn the editor's rows into what gets persisted on the provider: names are
 * trimmed, blank and invalid rows are dropped, and when two rows share a name
 * (header names are case-insensitive) the last one wins, which is also the
 * order the request builders apply them in.
 */
export function normalizeCustomHeaders(
  rows: ReadonlyArray<CustomHeaderRow>
): ProviderCustomHeader[] {
  const byName = new Map<string, ProviderCustomHeader>()
  for (const row of rows) {
    const header = row.header.trim()
    const value = row.value.trim()
    if (header.length === 0) continue
    if (!isValidHeaderName(header) || !isValidHeaderValue(value)) continue
    const key = header.toLowerCase()
    byName.delete(key)
    byName.set(key, { header, value })
  }
  return [...byName.values()]
}

export function customHeadersEqual(
  a: ReadonlyArray<ProviderCustomHeader> | null | undefined,
  b: ReadonlyArray<ProviderCustomHeader> | null | undefined
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every(
    (h, i) => h.header === right[i].header && h.value === right[i].value
  )
}

/** Editor rows for a provider: its stored headers, or one blank row to start with. */
export function customHeaderRowsFor(
  headers: ReadonlyArray<ProviderCustomHeader> | null | undefined
): CustomHeaderRow[] {
  const rows = (headers ?? []).map((h) => ({ header: h.header, value: h.value }))
  return rows.length > 0 ? rows : [emptyCustomHeaderRow()]
}
