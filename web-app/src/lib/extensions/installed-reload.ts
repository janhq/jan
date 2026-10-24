import { getExtensionHost } from './host'

/**
 * Brings the running copy of an installed extension in line with the
 * registry after the page changed it (enable, grants, update, rollback).
 * For now this stops it, so a revoked grant can no longer be used; the
 * installed loader (janhq/jan-internal#471) swaps in a respawn here.
 */
export function reloadInstalled(extensionId: string): Promise<void> {
  return getExtensionHost().terminate(extensionId)
}
