/** Cut to at most `limit` UTF-16 units ending in `marker`, never leaving half
 * of a surrogate pair at the cut. Text within the limit is returned as is. */
export function truncateUtf16(value: string, limit: number, marker: string): string {
  if (value.length <= limit) return value
  let keep = Math.max(0, limit - marker.length)
  const last = value.charCodeAt(keep - 1)
  // A trailing high surrogate here is the first half of a pair (or lone): drop it.
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep -= 1
  return value.slice(0, keep) + marker.slice(0, limit)
}
