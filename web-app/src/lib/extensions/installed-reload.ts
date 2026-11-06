import { getExtensionHost } from './host'

/**
 * Brings the running copy of an installed extension in line with the
 * registry after the page changed it (enable, grants, install, update,
 * rollback, uninstall): stopped, then started again from the registry when
 * it is still installed and enabled.
 */
export function reloadInstalled(extensionId: string): Promise<void> {
  return getExtensionHost().reload(extensionId)
}
