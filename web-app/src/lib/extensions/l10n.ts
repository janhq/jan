import { useCallback } from 'react'
import type { JanManifest } from '@janhq/extension-api'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

export type L10nTables = JanManifest['l10n']

/** Anything that carries an extension's `l10n` tables, a manifest included. */
export interface Localizable {
  l10n?: L10nTables
}

const REF = /^%([A-Za-z0-9_.-]+)%$/
const FALLBACK = 'en'

// Own properties only: locales and keys come from the extension, and
// `constructor` must not resolve to what every object inherits.
const lookup = (
  tables: Readonly<Record<string, Readonly<Record<string, string>>>>,
  locale: string,
  key: string
): string | undefined => {
  if (!Object.prototype.hasOwnProperty.call(tables, locale)) return undefined
  const table = tables[locale]
  return Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined
}

/**
 * `text` with a whole-string `%key%` replaced from `tables`: the language,
 * then its base (`de` for `de-DE`), then `en`. Anything else, an unknown
 * key included, is returned as written.
 */
export function resolveL10n(
  tables: L10nTables,
  text: string,
  language: string
): string {
  const ref = REF.exec(text)
  if (!ref || !tables) return text
  const key = ref[1]
  const base = language.split('-')[0]
  for (const locale of [language, base, FALLBACK]) {
    const value = lookup(tables, locale, key)
    if (value !== undefined) return value
  }
  return text
}

/** Resolves in the current app language, for code outside React. */
export function localize(holder: Localizable | undefined, text: string): string {
  return resolveL10n(
    holder?.l10n,
    text,
    useGeneralSetting.getState().currentLanguage
  )
}

/**
 * A resolver in the current app language for components. The component
 * re-renders, and its memos see a new resolver, when the language changes.
 */
export function useLocalize(): (
  holder: Localizable | undefined,
  text: string
) => string {
  const language = useGeneralSetting((s) => s.currentLanguage)
  return useCallback(
    (holder, text) => resolveL10n(holder?.l10n, text, language),
    [language]
  )
}
