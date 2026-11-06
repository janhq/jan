import type { IndexVersion } from '@/services/extensions/types'

export interface SourceInput {
  url: string
  name: string
  publicKey?: string
}

/** Error codes per field; each maps to `extensions:sources.errors.<code>`. */
export interface SourceErrors {
  url?: 'invalidUrl' | 'notHttps' | 'credentials'
  name?: 'required'
  publicKey?: 'invalidKey'
}

// An ed25519 public key is 32 bytes: 43 base64 characters plus one '='.
const ED25519_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/

/**
 * Checks a source before it is sent to the plugin, which checks again.
 * Unlike extension network grants, localhost gets no http exception: an
 * index decides what code gets installed, so it is only fetched over https.
 */
export function validateSource(input: SourceInput): SourceErrors {
  const errors: SourceErrors = {}
  let url: URL | undefined
  try {
    url = new URL(input.url.trim())
  } catch {
    errors.url = 'invalidUrl'
  }
  if (url) {
    if (url.protocol !== 'https:') errors.url = 'notHttps'
    else if (url.username || url.password) errors.url = 'credentials'
  }
  if (!input.name.trim()) errors.name = 'required'
  const key = input.publicKey?.trim()
  if (key && !ED25519_KEY.test(key)) errors.publicKey = 'invalidKey'
  return errors
}

const parts = (version: string) => {
  const [core, pre] = version.split('-', 2)
  return { nums: core.split('.').map(Number), pre }
}

/** semver precedence for the plain `MAJOR.MINOR.PATCH[-pre]` an index lists. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre < y.pre ? -1 : 1
}

/** The version a catalog offers to install. */
export function latestVersion(
  versions: readonly IndexVersion[]
): IndexVersion | undefined {
  return versions.reduce<IndexVersion | undefined>(
    (best, v) =>
      !best || compareVersions(v.version, best.version) > 0 ? v : best,
    undefined
  )
}
