import {
  isLocalHost,
  isPermissionString,
  networkHostMatches,
  networkHostOf,
  type PermissionKind,
  type PermissionString,
} from '@janhq/extension-api'

export type PermissionRisk = 'low' | 'medium' | 'high'

export interface PermissionInfo {
  risk: PermissionRisk
  /** i18n keys in the `extensions` namespace, for consent and settings. */
  titleKey: string
  descriptionKey: string
}

/** What each permission grants, how risky it is, and how to explain it. */
export const PERMISSIONS: Record<PermissionKind, PermissionInfo> = {
  'ui:notify': {
    risk: 'low',
    titleKey: 'extensions:permissions.uiNotify.title',
    descriptionKey: 'extensions:permissions.uiNotify.description',
  },
  'commands:execute': {
    risk: 'medium',
    titleKey: 'extensions:permissions.commandsExecute.title',
    descriptionKey: 'extensions:permissions.commandsExecute.description',
  },
  'network': {
    risk: 'medium',
    titleKey: 'extensions:permissions.network.title',
    descriptionKey: 'extensions:permissions.network.description',
  },
  'providers': {
    risk: 'medium',
    titleKey: 'extensions:permissions.providers.title',
    descriptionKey: 'extensions:permissions.providers.description',
  },
  'tools': {
    risk: 'high',
    titleKey: 'extensions:permissions.tools.title',
    descriptionKey: 'extensions:permissions.tools.description',
  },
  'conversations:read': {
    risk: 'high',
    titleKey: 'extensions:permissions.conversationsRead.title',
    descriptionKey: 'extensions:permissions.conversationsRead.description',
  },
  'conversations:write': {
    risk: 'high',
    titleKey: 'extensions:permissions.conversationsWrite.title',
    descriptionKey: 'extensions:permissions.conversationsWrite.description',
  },
  'chat:hooks': {
    risk: 'high',
    titleKey: 'extensions:permissions.chatHooks.title',
    descriptionKey: 'extensions:permissions.chatHooks.description',
  },
}

export type ParsedPermission =
  | { kind: Exclude<PermissionKind, 'network'> }
  | { kind: 'network'; host: string }

/** Splits a permission into its kind and, for network, its host grant. */
export function parsePermission(value: string): ParsedPermission | undefined {
  if (!isPermissionString(value)) return undefined
  const host = networkHostOf(value)
  if (host !== undefined) return { kind: 'network', host }
  return { kind: value as Exclude<PermissionKind, 'network'> }
}

/** `network:*` reaches any host, so it rates above a named one. */
export function riskOf(permission: PermissionString): PermissionRisk {
  if (permission === 'network:*') return 'high'
  const parsed = parsePermission(permission)
  return parsed ? PERMISSIONS[parsed.kind].risk : 'high'
}

/**
 * Whether the grant `grant` allows a request to `url`. https is required
 * except for localhost/127.0.0.1, where http is allowed too (a local
 * server rarely has a certificate). URLs with credentials are refused:
 * nothing legitimate needs them, and they hide the real host from a reader.
 */
export function matchesNetwork(grant: PermissionString, url: string): boolean {
  const host = networkHostOf(grant)
  if (host === undefined) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username || parsed.password) return false
  const hostname = parsed.hostname
  const scheme = parsed.protocol
  if (scheme !== 'https:' && !(scheme === 'http:' && isLocalHost(hostname)))
    return false
  return networkHostMatches(host, hostname)
}

/** What an update asks for beyond, and drops from, what was granted. */
export function diffPermissions(
  previous: readonly PermissionString[],
  next: readonly PermissionString[]
): { added: PermissionString[]; removed: PermissionString[] } {
  const before = new Set(previous)
  const after = new Set(next)
  return {
    added: next.filter((p) => !before.has(p)),
    removed: previous.filter((p) => !after.has(p)),
  }
}
