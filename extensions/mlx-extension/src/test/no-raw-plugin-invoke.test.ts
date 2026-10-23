import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Enforces the project rule that `invoke` for the mlx plugin lives only in the
// plugin's guest-js layer. A raw `invoke('plugin:mlx|...')` elsewhere bypasses
// the typed wrapper, so the arg shape is unchecked. The extension itself must
// not import `invoke` at all: app commands go through `@janhq/core`.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const EXTENSION_SRC = join(__dirname, '..')
const GUEST_JS = join(
  REPO_ROOT,
  'src-tauri',
  'plugins',
  'tauri-plugin-mlx',
  'guest-js'
)
// web-app is not scanned: it cannot depend on the mlx guest-js, which is only
// built on darwin, so its remaining raw call is left to the repo-wide guard.
const SEARCH_DIRS = [
  join(REPO_ROOT, 'core', 'src'),
  join(REPO_ROOT, 'extensions'),
  join(REPO_ROOT, 'src-tauri', 'plugins'),
]
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-js', 'target', 'build'])
const RAW_INVOKE = /['"]plugin:mlx\|/
const TAURI_CORE_IMPORT = /['"]@tauri-apps\/api\/core['"]/

function collect(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      // The guest-js layer is where these calls belong.
      if (full === GUEST_JS) continue
      out.push(...collect(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    // Test files legitimately assert on the wire-level command name.
    if (/\.test\.tsx?$/.test(entry)) continue
    out.push(full)
  }
  return out
}

function offendingLines(files: string[], pattern: RegExp): string[] {
  const offenders: string[] = []
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line)) {
          offenders.push(
            `${file.slice(REPO_ROOT.length + 1)}:${i + 1}: ${line.trim()}`
          )
        }
      })
  }
  return offenders
}

describe('invoke for plugin:mlx stays in guest-js', () => {
  it('has no raw plugin:mlx invoke in production source', () => {
    const offenders = offendingLines(SEARCH_DIRS.flatMap(collect), RAW_INVOKE)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('does not import @tauri-apps/api/core in mlx-extension', () => {
    const offenders = offendingLines(collect(EXTENSION_SRC), TAURI_CORE_IMPORT)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
