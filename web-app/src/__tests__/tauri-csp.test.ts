/**
 * Guards the main window's CSP and asset-protocol scope (janhq/jan-internal#458).
 *
 * tauri.conf.json is JSON, so the rationale for each source lives here:
 *
 * - script-src has no 'unsafe-eval'. Nothing in the production bundle needs it:
 *   lodash's `Function('return this')` is short-circuited by `self`, and zod v4's
 *   `new Function` fast path is turned off by `jitless` (lib/zodCsp.ts) so it never
 *   probes. shiki's oniguruma engine compiles a wasm module, which is what
 *   'wasm-unsafe-eval' allows and all it allows.
 * - script-src has no asset:, http://asset.localhost or $APPDATA. Built-in
 *   extensions are bundled into the app since dd021a737; nothing loads a script
 *   from disk, and the data folder is where runtime extensions would be unpacked.
 *   The posthog hosts stay for the analytics opt-in.
 * - worker-src is exactly 'self' blob:. An extension runs in a classic worker
 *   built from one blob: script (runtime prelude plus its bundle); the worker
 *   inherits this policy, so it can neither eval nor import more code. blob:
 *   is never added to script-src, which would let any page script load one.
 * - assetProtocol.scope is not `**` / `**`-slash-`*`. The static list is empty and
 *   the backend grants at runtime only what the window streams from disk: the
 *   Cowork session sandboxes at startup, files the user picks in the open
 *   dialog, and a Cowork session's attached folder (validated like the agent's
 *   read root, so it can never contain the Jan data folder).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TAURI_DIR = join(__dirname, '..', '..', '..', 'src-tauri')

interface AssetScope {
  allow?: string[]
}

interface Security {
  csp?: Record<string, string | string[]> | string | null
  assetProtocol?: { enable?: boolean; scope?: string[] | AssetScope }
}

interface TauriConf {
  app?: { security?: Security }
}

const confFiles = readdirSync(TAURI_DIR).filter((f) =>
  /^tauri(\..+)?\.conf\.json$/.test(f)
)

function load(file: string): Security | undefined {
  const conf = JSON.parse(
    readFileSync(join(TAURI_DIR, file), 'utf8')
  ) as TauriConf
  return conf.app?.security
}

function directive(csp: Security['csp'], name: string): string {
  if (!csp) return ''
  if (typeof csp === 'string') {
    const found = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `))
    return found ? found.slice(name.length + 1) : ''
  }
  const value = csp[name] ?? ''
  return Array.isArray(value) ? value.join(' ') : value
}

const scriptSrc = (csp: Security['csp']) => directive(csp, 'script-src')

function scopeAllow(security: Security): string[] {
  const scope = security.assetProtocol?.scope
  if (!scope) return []
  return Array.isArray(scope) ? scope : (scope.allow ?? [])
}

describe('tauri window CSP and asset scope', () => {
  it('finds the main config', () => {
    expect(confFiles).toContain('tauri.conf.json')
  })

  it('the main config declares a script-src', () => {
    expect(scriptSrc(load('tauri.conf.json')?.csp)).not.toBe('')
  })

  it("lets the main window start extension workers from blob: only", () => {
    const sources = directive(load('tauri.conf.json')?.csp, 'worker-src')
      .split(/\s+/)
      .filter(Boolean)
      .sort()
    expect(sources).toEqual(["'self'", 'blob:'])
  })

  describe.each(confFiles)('%s', (file) => {
    const security = load(file)

    it('script-src allows no eval and no scripts from disk', () => {
      const sources = scriptSrc(security?.csp).split(/\s+/)
      expect(sources).not.toContain("'unsafe-eval'")
      expect(sources).not.toContain('asset:')
      expect(sources).not.toContain('http://asset.localhost')
      expect(sources.some((s) => s.includes('$APPDATA'))).toBe(false)
      expect(sources).not.toContain('blob:')
      expect(sources).not.toContain('data:')
    })

    it('the asset protocol cannot read the whole disk', () => {
      if (!security) return
      const allow = scopeAllow(security)
      expect(allow).not.toContain('**/*')
      expect(allow).not.toContain('**')
    })
  })
})
