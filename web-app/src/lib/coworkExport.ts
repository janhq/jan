import type { CoworkSession } from '@/hooks/useCoworkSessions'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { Invoke } from '@/lib/migrateCoworkSessions'

/** Data-folder-relative directory exports land in. */
export const COWORK_EXPORT_DIR = 'cowork-exports'

/**
 * Save one Cowork session, exactly as the app holds it, to
 * `<data>/cowork-exports/<id>.json` and return the absolute path. Meant for a
 * session that cannot be opened normally (not imported, unreadable data): the
 * file keeps the transcript readable outside Jan and can be attached to a bug
 * report. The file commands only write inside the data folder, so the export
 * goes there and is then shown in the file manager.
 */
export async function exportCoworkSession(
  session: CoworkSession,
  invoke: Invoke = (cmd, args) => getServiceHub().core().invoke(cmd, args)
): Promise<string> {
  const dataFolder = await getServiceHub().app().getJanDataFolder()
  if (!dataFolder) throw new Error('no data folder')
  // An abandoned session's id may be one the backend refused (that can be the
  // reason it was abandoned): never let it shape the path.
  const safe =
    session.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'session'
  // Windows reserves device names even with an extension (con.json).
  const name = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? `_${safe}` : safe
  const relative = `${COWORK_EXPORT_DIR}/${name}.json`
  await invoke('mkdir', { args: [COWORK_EXPORT_DIR] })
  const body = JSON.stringify(
    {
      exportedFrom: 'jan-cowork',
      exportedAt: new Date().toISOString(),
      session,
    },
    null,
    2
  )
  await invoke('write_file_sync', { args: [relative, body] })
  return joinDataPath(dataFolder, relative)
}

function joinDataPath(dataFolder: string, relative: string): string {
  const sep =
    dataFolder.includes('\\') && !dataFolder.includes('/') ? '\\' : '/'
  return `${dataFolder.replace(/[\\/]+$/, '')}${sep}${relative.split('/').join(sep)}`
}
