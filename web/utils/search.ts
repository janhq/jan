/**
 * Searches for a query in a list of data using a fuzzy search algorithm.
 */
export function fuzzySearch(needle: string, haystack: string) {
  const hlen = haystack.length
  const nlen = needle.length
  if (nlen > hlen) {
    return false
  }
  if (nlen === hlen) {
    return needle === haystack
  }
  outer: for (let i = 0, j = 0; i < nlen; i++) {
    const nch = needle.charCodeAt(i)
    while (j < hlen) {
      if (haystack.charCodeAt(j++) === nch) {
        continue outer
      }
    }
    return false
  }
  return true
}
