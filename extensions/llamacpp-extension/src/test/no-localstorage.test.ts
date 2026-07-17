import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Enforces the "backend-only persistence" rule: the extension must not touch
// webview localStorage (it isn't the source of truth on desktop — settings
// live in settings.json via backend-settings.ts). The single sanctioned
// exception is the one-time pre-backend migration, whose lines carry the
// `localstorage-migration-allowed` marker.
const SRC_DIR = join(__dirname, '..')
const ALLOW_MARKER = 'localstorage-migration-allowed'
// Actual usage (member/index access), not the word inside a comment.
const USAGE = /localStorage\s*[.[]/

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full))
      continue
    }
    if (!entry.endsWith('.ts')) continue
    if (entry.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

describe('no localStorage outside the sanctioned migration', () => {
  it('has no unmarked localStorage usage in extension source', () => {
    const offenders: string[] = []
    for (const file of collectSourceFiles(SRC_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (USAGE.test(line) && !line.includes(ALLOW_MARKER)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
