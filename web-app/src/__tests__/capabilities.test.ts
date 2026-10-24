/**
 * Guards which Tauri capability may reach the extensions plugin
 * (janhq/jan-internal#470).
 *
 * The plugin installs and runs third-party code and is built only with the
 * `desktop` cargo feature, so `extensions:` permissions belong in
 * desktop.json alone: that capability is limited to the main window and to
 * desktop platforms. Granting them anywhere else would either reach another
 * window or name a plugin that a mobile build does not contain, which fails
 * tauri-build's capability check.
 *
 * desktop.json is only active because tauri.conf.json lists it; Tauri ignores
 * capability files the config does not name. Activating it must not widen
 * anything else, so apart from `extensions:` it may only repeat what
 * default.json grants or what `core:default` already includes.
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
  permissions: Permission[]
}

const read = <T,>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const capabilityFiles = readdirSync(CAPABILITIES_DIR).filter((f) =>
  f.endsWith('.json')
)

const identifierOf = (p: Permission) => (typeof p === 'string' ? p : p.identifier)

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)])
        )
      : value

// Normalised for comparison: the description is commentary.
const shapeOf = (p: Permission) => {
  if (typeof p === 'string') return p
  const rest: Record<string, unknown> = { ...p }
  delete rest.description
  return JSON.stringify(canonical(rest))
}

// What `core:default` expands to for the two entries desktop.json spells
// out (tauri 2: core:window:default and core:event:default).
const IN_CORE_DEFAULT = new Set([
  'core:window:allow-get-all-windows',
  'core:event:allow-listen',
])

describe('Tauri capabilities', () => {
  it('grants extensions: permissions in desktop.json only', () => {
    const holders = capabilityFiles.filter((file) =>
      read<Capability>(join(CAPABILITIES_DIR, file)).permissions.some((p) =>
        identifierOf(p).startsWith('extensions:')
      )
    )
    expect(holders).toEqual(['desktop.json'])
  })

  it('keeps desktop.json to the main window on desktop platforms', () => {
    const desktop = read<Capability>(join(CAPABILITIES_DIR, 'desktop.json'))
    expect(desktop.windows).toEqual(['main'])
    expect([...(desktop.platforms ?? [])].sort()).toEqual([
      'linux',
      'macOS',
      'windows',
    ])
    expect(desktop.permissions.map(identifierOf)).toContain('extensions:default')
  })

  it('activates desktop.json in the desktop config and not on mobile', () => {
    const active = (file: string) =>
      read<{ app?: { security?: { capabilities?: string[] } } }>(
        join(TAURI_DIR, file)
      ).app?.security?.capabilities
    expect(active('tauri.conf.json')).toContain('desktop')
    for (const mobile of ['tauri.android.conf.json', 'tauri.ios.conf.json'])
      expect(active(mobile)).not.toContain('desktop')
  })

  it('adds nothing but extensions: to what default.json already grants', () => {
    const shapes = new Set(
      read<Capability>(join(CAPABILITIES_DIR, 'default.json')).permissions.map(
        shapeOf
      )
    )
    const extra = read<Capability>(
      join(CAPABILITIES_DIR, 'desktop.json')
    ).permissions.filter(
      (p) =>
        !identifierOf(p).startsWith('extensions:') &&
        !shapes.has(shapeOf(p)) &&
        !IN_CORE_DEFAULT.has(identifierOf(p))
    )
    expect(extra.map(identifierOf)).toEqual([])
  })
})
