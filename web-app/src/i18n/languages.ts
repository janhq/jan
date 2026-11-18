export const SUPPORTED_LANGUAGES = [
  'en',
  'es',
  'fr',
  'it',
  'hi',
  'id',
  'vn',
  'pl',
  'zh-CN',
  'zh-TW',
  'de-DE',
  'cs',
  'pt-BR',
  'ko',
  'ja',
  'ru',
  'ca',
] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  it: 'it',
  hi: 'hi',
  id: 'id',
  in: 'id',
  vi: 'vn',
  vn: 'vn',
  pl: 'pl',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  'zh-hant': 'zh-TW',
  de: 'de-DE',
  'de-de': 'de-DE',
  'de-at': 'de-DE',
  'de-ch': 'de-DE',
  cs: 'cs',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-BR',
  ko: 'ko',
  ja: 'ja',
  ru: 'ru',
  ca: 'ca',
}

const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

function matchLanguage(tag: string): SupportedLanguage | undefined {
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-')
  if (!normalized) return undefined

  const subtags = normalized.split('-')
  while (subtags.length > 0) {
    const match = LANGUAGE_ALIASES[subtags.join('-')]
    if (match) return match
    subtags.pop()
  }

  return undefined
}

export function detectLanguage(): SupportedLanguage {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE

  const preferred = navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : []

  for (const tag of preferred) {
    const match = matchLanguage(tag)
    if (match) return match
  }

  return DEFAULT_LANGUAGE
}
