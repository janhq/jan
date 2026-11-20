/**
 * What an extension may ask for in `jan.permissions`. Everything not listed
 * here (own settings, own contributions, logging, own storage) is implicit.
 */
export type PermissionString =
  | 'ui:notify'
  | 'providers'
  | 'tools'
  | 'conversations:read'
  | 'conversations:write'
  | 'chat:hooks'
  | `network:${string}`

/** A permission with any `network:<host>` collapsed to `network`. */
export type PermissionKind =
  | Exclude<PermissionString, `network:${string}`>
  | 'network'

const FIXED_PERMISSIONS: ReadonlySet<string> = new Set<
  Exclude<PermissionKind, 'network'>
>([
  'ui:notify',
  'providers',
  'tools',
  'conversations:read',
  'conversations:write',
  'chat:hooks',
])

const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?'
// Lowercase host names only: grants are compared as strings, and URL parsing
// lowercases hosts, so an uppercase grant could never match.
const HOST = new RegExp(`^(\\*|(\\*\\.)?${LABEL}(\\.${LABEL})*)$`)

const NETWORK_PREFIX = 'network:'

/**
 * True for a host grant usable after `network:`: `*`, an exact host
 * (`api.example.com`, `127.0.0.1`, `localhost`) or a subdomain wildcard
 * (`*.example.com`). No scheme, port or path: the scheme rule is fixed
 * (https, or http for local hosts) and ports are not a trust boundary.
 */
export function isNetworkHost(host: string): boolean {
  return HOST.test(host)
}

/** Narrows a manifest entry to a well-formed `PermissionString`. */
export function isPermissionString(value: string): value is PermissionString {
  if (value.startsWith(NETWORK_PREFIX))
    return isNetworkHost(value.slice(NETWORK_PREFIX.length))
  return FIXED_PERMISSIONS.has(value)
}

/** The host part of a `network:<host>` permission, or undefined for any other. */
export function networkHostOf(
  permission: PermissionString
): string | undefined {
  return permission.startsWith(NETWORK_PREFIX)
    ? permission.slice(NETWORK_PREFIX.length)
    : undefined
}

/**
 * Whether the host grant `grant` (as returned by `networkHostOf`) covers the
 * URL host `host`. `*.example.com` covers subdomains only, not the apex, so
 * granting an API subdomain never silently grants the main site.
 */
export function networkHostMatches(grant: string, host: string): boolean {
  if (grant === '*') return true
  if (grant.startsWith('*.'))
    return host.endsWith(grant.slice(1)) && host.length > grant.length - 1
  return grant === host
}

/** Hosts reachable over plain http; everything else must use https. */
export function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1'
}
