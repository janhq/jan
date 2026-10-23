const VERSION = /^(\d+)\.(\d+)\.(\d+)$/
const CARET = /^\^(\d+)\.(\d+)\.(\d+)$/
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/

type Triple = [number, number, number]

const triple = (m: RegExpExecArray): Triple => [
  Number(m[1]),
  Number(m[2]),
  Number(m[3]),
]

const compare = (a: Triple, b: Triple): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** True for a full semver 2.0.0 version, prerelease and build parts included. */
export function isSemver(version: string): boolean {
  return SEMVER.test(version)
}

/** True for the only range form manifests may use: `^MAJOR.MINOR.PATCH`. */
export function isCaretRange(range: string): boolean {
  return CARET.test(range)
}

/**
 * Whether a host API `host` (plain `MAJOR.MINOR.PATCH`) satisfies the caret
 * range `range`, with npm's caret semantics: the left-most non-zero part is
 * locked, so before 1.0 every minor is a breaking change. Hand-rolled so the
 * package needs no dependency; anything but a caret range is incompatible.
 */
export function isApiCompatible(range: string, host: string): boolean {
  const r = CARET.exec(range)
  const h = VERSION.exec(host)
  if (!r || !h) return false
  const floor = triple(r)
  const version = triple(h)
  if (compare(version, floor) < 0) return false
  if (floor[0] > 0) return version[0] === floor[0]
  if (floor[1] > 0) return version[0] === 0 && version[1] === floor[1]
  return compare(version, floor) === 0
}
