import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const load = (locale: string, ns: string) =>
  JSON.parse(readFileSync(join(ROOT, locale, `${ns}.json`), 'utf8'))
const lookup = (o: unknown, path: string) =>
  path.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], o)

// Strings that used to render as English inside otherwise translated screens.
const GAPS: Array<[string, string]> = [
  ['settings', 'general.autoUpdateCheck'],
  ['settings', 'general.autoUpdateCheckDesc'],
  ['settings', 'general.janCliDesc'],
  ['extensions', 'crashed.safeMode'],
  ['extensions', 'crashed.safeModeFailed'],
]

describe.each(['de-DE', 'fr', 'ja', 'zh-CN'])('%s', (locale) => {
  it.each(GAPS)('translates %s %s', (ns, key) => {
    const own = lookup(load(locale, ns), key)
    expect(typeof own).toBe('string')
    expect(own).not.toBe(lookup(load('en', ns), key))
  })
})
