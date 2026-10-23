import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Enforces the project rule that `invoke` for the llamacpp plugin lives only in
// the plugin's guest-js layer. A raw `invoke('plugin:llamacpp|...')` elsewhere
// bypasses the typed wrapper, so the arg shape is unchecked -- which is how
// getDevices shipped sending a `libraryPath` the command does not take while
// omitting the `envs` it requires.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const GUEST_JS = join(
  REPO_ROOT,
  'src-tauri',
  'plugins',
  'tauri-plugin-llamacpp',
  'guest-js'
)
const SEARCH_DIRS = [
  join(REPO_ROOT, 'web-app', 'src'),
  join(REPO_ROOT, 'core', 'src'),
  join(REPO_ROOT, 'extensions'),
  join(REPO_ROOT, 'src-tauri', 'plugins'),
]
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-js', 'target', 'build'])
const RAW_INVOKE = /['"]plugin:llamacpp\|/

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

describe('invoke for plugin:llamacpp stays in guest-js', () => {
  it('has no raw plugin:llamacpp invoke in production source', () => {
    const offenders: string[] = []
    for (const dir of SEARCH_DIRS) {
      for (const file of collect(dir)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (RAW_INVOKE.test(line)) {
              offenders.push(
                `${file.slice(REPO_ROOT.length + 1)}:${i + 1}: ${line.trim()}`
              )
            }
          })
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

// App commands (read_yaml, settings_get, ...) are reached through the
// @janhq/core wrappers, so the extension never needs Tauri's raw `invoke`.
const EXTENSION_SRC = join(__dirname, '..')
const CORE_INVOKE_IMPORT = /['"]@tauri-apps\/api\/core['"]/

describe('llamacpp-extension does not import @tauri-apps/api/core', () => {
  it('has no @tauri-apps/api/core import in production source', () => {
    const offenders: string[] = []
    for (const file of collect(EXTENSION_SRC)) {
      // Test harness files mock the module rather than calling it.
      if (file.startsWith(join(EXTENSION_SRC, 'test'))) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (CORE_INVOKE_IMPORT.test(line)) {
            offenders.push(
              `${file.slice(REPO_ROOT.length + 1)}:${i + 1}: ${line.trim()}`
            )
          }
        })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
