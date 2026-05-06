import { join } from 'node:path'

/**
 * Per-worker profile state. wdio.conf.ts sets `profileDir` in
 * `beforeSession`; helpers read it later. Both run in the same worker
 * process, so module-level state is shared.
 */
let profileDir: string | undefined

export function setProfileDir(dir: string): void {
  profileDir = dir
}

export function clearProfileDir(): void {
  profileDir = undefined
}

export function getProfileDir(): string | undefined {
  return profileDir
}

/**
 * Resolve the Jan data folder within the active profile. Mirrors
 * resolve_jan_data_folder() in src-tauri/src/core/app/commands.rs:
 * `<dirs::data_dir()>/Jan/data`. Linux pins data_dir() to
 * `XDG_DATA_HOME` (set on the profile dir); Windows uses `APPDATA`.
 */
export function getJanDataFolder(): string {
  if (!profileDir) {
    throw new Error(
      'Jan profile dir not initialized. Call seed* helpers from a spec running under wdio.conf.ts.'
    )
  }
  return join(profileDir, 'Jan', 'data')
}
