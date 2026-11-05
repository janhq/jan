import { afterAll, describe, expect, it } from 'vitest'
import i18n from '@/i18n/setup'

// Resolved through the real runtime lookup (language, then English fallback),
// so a key that is missing in a locale shows up as the English text.
const KEYS: Array<[string, Record<string, unknown>]> = [
  ['common:projects.deleteProjectDialog.permanentDelete', { projectName: 'Alpha' }],
  ['common:projects.sendMessageToStart', {}],
  ['common:dialogs.deleteAllChats.title', {}],
  ['common:dialogs.deleteAllChats.description', {}],
  ['common:toast.deleteAllChats.title', {}],
  ['common:toast.deleteAllChats.description', {}],
  ['common:overview.description', {}],
  ['common:askToolPending', {}],
  ['common:askToolAsked', {}],
  ['settings:interface.themeDescFixed', {}],
  ['provider:nameLabel', {}],
  ['settings:general.autoUpdateCheck', {}],
  ['settings:general.janCliDesc', {}],
  ['extensions:crashed.safeMode', {}],
]

const original = i18n.language
afterAll(() => i18n.changeLanguage(original))

describe.each(['de-DE', 'fr', 'ja', 'zh-CN'])('%s runtime lookup', (locale) => {
  it.each(KEYS)('translates %s', (key, vars) => {
    i18n.changeLanguage('en')
    const english = i18n.t(key, vars)
    i18n.changeLanguage(locale)
    const own = i18n.t(key, vars)
    expect(own).not.toBe(key)
    // "Name" is the same word in German.
    if (!(locale === 'de-DE' && key === 'provider:nameLabel')) expect(own).not.toBe(english)
    if (key.endsWith('permanentDelete')) expect(own).toContain('Alpha')
  })
})
