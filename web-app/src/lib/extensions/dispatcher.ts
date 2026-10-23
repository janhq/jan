import {
  ExtensionError,
  networkHostMatches,
  networkHostOf,
  type PermissionString,
} from '@janhq/extension-api'

/**
 * The single place that decides whether an extension may use a gated part of
 * `ExtensionContext`. P1 grants built-ins exactly what their manifest
 * requests; P2 extends this class with user grants for worker extensions,
 * so every runtime keeps one enforcement path.
 */
export class PermissionDispatcher {
  private readonly grants = new Map<string, ReadonlySet<PermissionString>>()

  /** Replaces the grants of `extensionId`. */
  grant(extensionId: string, permissions: readonly PermissionString[]): void {
    this.grants.set(extensionId, new Set(permissions))
  }

  revokeAll(extensionId: string): void {
    this.grants.delete(extensionId)
  }

  /**
   * Whether `permission` is granted. A `network:<host>` request is matched
   * against every network grant, so `network:*.acme.dev` covers
   * `network:api.acme.dev`.
   */
  has(extensionId: string, permission: PermissionString): boolean {
    const granted = this.grants.get(extensionId)
    if (!granted) return false
    if (granted.has(permission)) return true
    const host = networkHostOf(permission)
    if (host === undefined) return false
    return [...granted].some((g) => {
      const grant = networkHostOf(g)
      return grant !== undefined && networkHostMatches(grant, host)
    })
  }

  /** Throws `E_PERMISSION` unless `permission` is granted. */
  check(extensionId: string, permission: PermissionString): void {
    if (!this.has(extensionId, permission)) {
      throw new ExtensionError(
        'E_PERMISSION',
        `Extension '${extensionId}' lacks the permission '${permission}'`
      )
    }
  }
}
