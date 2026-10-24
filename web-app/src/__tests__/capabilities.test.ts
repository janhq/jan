/**
 * Guards which Tauri capability may reach the extensions plugin
 * (janhq/jan-internal#470).
 *
 * The plugin installs and runs third-party code and is built only with the
 * `desktop` cargo feature, so `extensions:` permissions live in their own
 * capability, extensions.json, and nowhere else. That capability is limited
 * to the main window and to desktop platforms, and has no `remote` section:
 * only the app's own content may call the plugin, never a page loaded from
 * an http origin. Granting the permissions anywhere else would either reach
 * another window or a remote origin, or name a plugin that a mobile build
 * does not contain, which fails tauri-build's capability check.
 *
 * Tauri ignores capability files the config does not name, so
 * extensions.json is listed in tauri.conf.json. desktop.json is not: it
 * carries a `remote` section and grants beyond default.json, and activating
 * it would silently widen what the main window may do.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TAURI_DIR = join(__dirname, '..', '..', '..', 'src-tauri')
const CAPABILITIES_DIR = join(TAURI_DIR, 'capabilities')

type Permission = string | { identifier: string; [key: string]: unknown }

interface Capability {
  identifier: string
  windows?: string[]
  platforms?: string[]
  remote?: unknown
  permissions: Permission[]
}

const read = <T,>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const capabilityFiles = readdirSync(CAPABILITIES_DIR).filter((f) =>
  f.endsWith('.json')
)

const identifierOf = (p: Permission) => (typeof p === 'string' ? p : p.identifier)

const activeIn = (file: string) =>
  read<{ app?: { security?: { capabilities?: string[] } } }>(
    join(TAURI_DIR, file)
  ).app?.security?.capabilities ?? []

describe('Tauri capabilities', () => {
  it('grants extensions: permissions in extensions.json only', () => {
    const holders = capabilityFiles.filter((file) =>
      read<Capability>(join(CAPABILITIES_DIR, file)).permissions.some((p) =>
        identifierOf(p).startsWith('extensions:')
      )
    )
    expect(holders).toEqual(['extensions.json'])
  })

  it('keeps extensions.json to the main window, local content and desktop', () => {
    const extensions = read<Capability>(
      join(CAPABILITIES_DIR, 'extensions.json')
    )
    expect(extensions.identifier).toBe('extensions')
    expect(extensions.windows).toEqual(['main'])
    expect(extensions.remote).toBeUndefined()
    expect([...(extensions.platforms ?? [])].sort()).toEqual([
      'linux',
      'macOS',
      'windows',
    ])
    expect(extensions.permissions).toEqual(['extensions:default'])
  })

  it('activates extensions.json in the desktop config and not on mobile', () => {
    expect(activeIn('tauri.conf.json')).toContain('extensions')
    for (const mobile of ['tauri.android.conf.json', 'tauri.ios.conf.json'])
      expect(activeIn(mobile)).not.toContain('extensions')
  })

  it('leaves desktop.json inactive', () => {
    for (const file of [
      'tauri.conf.json',
      'tauri.android.conf.json',
      'tauri.ios.conf.json',
    ])
      expect(activeIn(file)).not.toContain('desktop')
  })
})
