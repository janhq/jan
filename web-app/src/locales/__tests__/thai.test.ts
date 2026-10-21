import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const locales = join(__dirname, '..')
const namespaces = readdirSync(join(locales, 'en')).filter((name) => name.endsWith('.json'))
function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => Object.entries(leaves(child, prefix ? `${prefix}.${key}` : key))))
}
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
const code = (text: string) => text.match(/`[^`]*`/g) ?? []
const identifiers = (text: string) => (text.match(/\b(?:memory_read|memory_write|web_search|web_fetch|chat_template_kwargs|YOUR-RESOURCE-NAME)\b|(?<!\w)\/(?:help|models)\b/g) ?? []).sort()

describe('Thai locale completeness', () => {
  it.each(namespaces)('%s keeps every English key, interpolation and code literal', (namespace) => {
    const english = leaves(JSON.parse(readFileSync(join(locales, 'en', namespace), 'utf8')))
    const thai = leaves(JSON.parse(readFileSync(join(locales, 'th', namespace), 'utf8')))
    expect(Object.keys(thai).sort()).toEqual(Object.keys(english).sort())
    for (const [key, original] of Object.entries(english)) {
      const translated = thai[key]
      if (original) expect(translated.length, key).toBeGreaterThan(0)
      expect(placeholders(translated), key).toEqual(placeholders(original))
      expect(code(translated), key).toEqual(code(original))
      expect(identifiers(translated), key).toEqual(identifiers(original))
      expect(translated, key).not.toMatch(/[⟦⟧⟪⟫]|ZXQ|QXZ|JANPH|JANSEG|⟦[\d]+⟧|⟪[\d]+⟫|\uFFFD/)
    }
  })
})
