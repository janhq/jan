import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import i18n from '../../i18n/setup'
import { localStorageKey } from '../../constants/localStorage'

const locales = resolve(__dirname, '..')
const namespaces = readdirSync(join(locales, 'en')).filter((file) =>
  file.endsWith('.json')
)

function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) =>
        Object.entries(leaves(child, `${prefix}${key}.`))
      )
    )
  }
  if (typeof value !== 'string') throw new Error(`Not a string: ${prefix}`)
  return { [prefix]: value }
}

function bundle(locale: string, file: string) {
  return leaves(JSON.parse(readFileSync(join(locales, locale, file), 'utf8')))
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()

describe('Turkish locale', () => {
  afterEach(() => {
    i18n.changeLanguage('en')
    localStorage.removeItem(localStorageKey.settingGeneral)
  })

  it.each(namespaces)(
    '%s translates every key and preserves placeholders',
    (file) => {
      const english = bundle('en', file)
      const turkish = bundle('tr', file)
      expect(Object.keys(turkish).sort()).toEqual(Object.keys(english).sort())
      for (const [key, text] of Object.entries(english)) {
        expect(turkish[key].trim(), `${file}: ${key}`).not.toBe('')
        expect(placeholders(turkish[key]), `${file}: ${key}`).toEqual(
          placeholders(text)
        )
      }
    }
  )

  it('loads Turkish, interpolates values and saves the language choice', () => {
    i18n.changeLanguage('tr')
    expect(i18n.language).toBe('tr')
    expect(i18n.t('common:settings')).toBe('Ayarlar')
    expect(i18n.t('setup:checkModelReady', { model: 'Llama' })).toBe(
      'Llama hazır'
    )
    expect(
      JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!).state
        .currentLanguage
    ).toBe('tr')
  })

  it('uses Turkish number forms without adding an English plural suffix', () => {
    i18n.changeLanguage('tr')
    for (const count of [0, 1, 3]) {
      expect(i18n.t('common:subagentToolUses', { count })).toBe(
        `${count} araç kullanımı`
      )
    }
  })
})
