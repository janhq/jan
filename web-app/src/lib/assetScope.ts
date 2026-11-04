import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

/**
 * The asset protocol serves nothing statically (see tauri.conf.json and
 * core::filesystem::asset_scope). A Cowork session's attached folder is
 * user-chosen and can live anywhere, so it is granted at runtime, once per
 * folder per launch, for its artifact thumbnails and preview pane.
 */
const granted = new Set<string>()

export function grantFolders(folders: Array<string | null>): void {
  if (!isPlatformTauri()) return
  for (const folder of folders) {
    if (!folder || granted.has(folder)) continue
    // Not retried on failure: the backend refuses a folder for a reason that
    // will not change (it contains the data folder, or no longer exists), and
    // a retry would fire on every store update.
    granted.add(folder)
    void getServiceHub()
      .core()
      .invoke('asset_scope_allow_folder', { folder })
      .catch((error: unknown) => {
        console.warn('Cowork folder not granted to the asset protocol:', error)
      })
  }
}

/** Grant every session's folder now, and each newly attached one after. */
export function grantCoworkFolders(): void {
  const folders = () => useCoworkSessions.getState().sessions.map((s) => s.folder)
  grantFolders(folders())
  useCoworkSessions.subscribe(() => grantFolders(folders()))
}
