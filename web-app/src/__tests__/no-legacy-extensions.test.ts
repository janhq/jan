/**
 * Guards the removal of the legacy extension system (janhq/jan-internal#479).
 *
 * Every built-in now runs on the ExtensionHost through `activate(ctx)`, so
 * the old base class, its manager and its type enum must not come back in
 * the app, the core SDK or any built-in extension. The names are assembled
 * from fragments so this file does not match its own scan or a repo grep.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
const EXT = 'Extension'
const LEGACY = new RegExp(
  [
    `Base${EXT}`,
    `${EXT}Manager`,
    `${EXT}TypeEnum`,
    `${EXT.toLowerCase()}Manager`,
  ].join('|')
)
const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE.test(entry.name) ? [path] : []
  })
}

function scanRoots(): string[] {
  const extensions = join(REPO, 'extensions')
  const extensionSources = readdirSync(extensions)
    .map((name) => join(extensions, name, 'src'))
    .filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })
  return [join(REPO, 'web-app', 'src'), join(REPO, 'core', 'src'), ...extensionSources]
}

describe('legacy extension system', () => {
  it('scans every built-in extension source tree', () => {
    expect(scanRoots().length).toBeGreaterThan(2)
  })

  it('is not referenced from web-app, core or extensions', () => {
    const offenders = scanRoots()
      .flatMap(sourceFiles)
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => LEGACY.test(line))
          .map(({ index }) => `${relative(REPO, file)}:${index + 1}`)
      )
    expect(offenders).toEqual([])
  })
})
