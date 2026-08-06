import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

/**
 * The custom `t` returns the key itself when a lookup fails, so a missing entry
 * renders `tools:toolApproval.title` at the user rather than throwing or falling
 * back. That is invisible in review and in every other test, which is how five
 * approval-dialog keys and two toast keys shipped broken.
 *
 * This walks every statically-written `t('ns:key')` in the app and asserts it
 * resolves in the `en` locale, which is also the fallback for every other one.
 */
const SRC = resolve(__dirname, '../..')
const LOCALES = join(SRC, 'locales/en')

const loadEnglish = (): Record<string, unknown> =>
  Object.fromEntries(
    readdirSync(LOCALES)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [
        basename(f, '.json'),
        JSON.parse(readFileSync(join(LOCALES, f), 'utf-8')),
      ])
  )

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      return e.name === '__tests__' || e.name === 'node_modules'
        ? []
        : sourceFiles(full)
    }
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : []
  })

const resolves = (
  bundle: Record<string, unknown>,
  ns: string,
  key: string
): boolean => {
  let cur: unknown = bundle[ns]
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return false
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string'
}

// Only literal keys; dynamically-built ones can't be checked statically.
const KEY_CALL = /t\(\s*['"]([a-zA-Z0-9_-]+):([a-zA-Z0-9_.]+)['"]/g

describe('i18n keys', () => {
  it('resolves every statically-referenced key in the en locale', () => {
    const bundle = loadEnglish()
    const missing: string[] = []

    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf-8')
      for (const [, ns, key] of text.matchAll(KEY_CALL)) {
        if (!resolves(bundle, ns, key)) {
          missing.push(`${ns}:${key} (${file.slice(SRC.length + 1)})`)
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('finds the locale bundle it is auditing', () => {
    const bundle = loadEnglish()
    expect(Object.keys(bundle).length).toBeGreaterThan(5)
    expect(resolves(bundle, 'tools', 'toolApproval.title')).toBe(true)
  })
})
