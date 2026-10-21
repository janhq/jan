import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Enforces the project rule that `invoke` for the local engine plugin lives
// only in the plugin's guest-js layer, the same way the llama.cpp plugin is
// held to it. A raw `invoke('plugin:local-engine|...')` elsewhere bypasses
// the typed wrapper, so the arg shape is unchecked -- and the arg shape is
// what the plugin checks (the engine id, the data folder).
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const GUEST_JS = join(
  REPO_ROOT,
  'src-tauri',
  'plugins',
  'tauri-plugin-local-engine',
  'guest-js'
)
const SEARCH_DIRS = [
  join(REPO_ROOT, 'web-app', 'src'),
  join(REPO_ROOT, 'core', 'src'),
  join(REPO_ROOT, 'extensions'),
  join(REPO_ROOT, 'packages'),
  join(REPO_ROOT, 'src-tauri', 'plugins'),
]
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-js', 'target', 'build'])
const RAW_INVOKE = /['"]plugin:local-engine\|/

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
    let isDirectory = false
    try {
      isDirectory = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDirectory) {
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

describe('invoke for plugin:local-engine stays in guest-js', () => {
  // The scan reads every source file in the repo, so it is bound by disk
  // latency rather than by anything the test does. The default timeout is
  // too tight when the machine is busy.
  it(
    'has no raw plugin:local-engine invoke in production source',
    () => {
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
    },
    60_000
  )
})
