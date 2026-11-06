import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { localize, resolveL10n, useLocalize } from '../l10n'

const l10n = {
  en: { 'greet.title': 'Say hello', 'only.en': 'English only' },
  ja: { 'greet.title': 'Konnichiwa' },
  de: { 'greet.title': 'Hallo sagen' },
}

afterEach(() => useGeneralSetting.setState({ currentLanguage: 'en' }))

describe('resolveL10n', () => {
  it('resolves a %key% in the given language', () => {
    expect(resolveL10n(l10n, '%greet.title%', 'ja')).toBe('Konnichiwa')
  })

  it('falls back to the base language of a regional one', () => {
    expect(resolveL10n(l10n, '%greet.title%', 'de-DE')).toBe('Hallo sagen')
  })

  it('falls back to en, then to the raw string', () => {
    expect(resolveL10n(l10n, '%only.en%', 'ja')).toBe('English only')
    expect(resolveL10n(l10n, '%missing%', 'ja')).toBe('%missing%')
    expect(resolveL10n(undefined, '%greet.title%', 'ja')).toBe('%greet.title%')
  })

  it('leaves literals alone, including ones that only contain a %key%', () => {
    expect(resolveL10n(l10n, 'Say hello', 'ja')).toBe('Say hello')
    expect(resolveL10n(l10n, 'x %greet.title%', 'ja')).toBe('x %greet.title%')
  })

  it('never finds what a table inherits', () => {
    expect(resolveL10n(l10n, '%constructor%', 'en')).toBe('%constructor%')
    expect(resolveL10n(l10n, '%greet.title%', 'constructor')).toBe('Say hello')
  })
})

describe('localize', () => {
  it('resolves in the current app language', () => {
    useGeneralSetting.setState({ currentLanguage: 'ja' })
    expect(localize({ l10n }, '%greet.title%')).toBe('Konnichiwa')
    expect(localize(undefined, '%greet.title%')).toBe('%greet.title%')
  })
})

describe('useLocalize', () => {
  it('re-renders with the new language when it changes', () => {
    const { result } = renderHook(() => useLocalize())
    expect(result.current({ l10n }, '%greet.title%')).toBe('Say hello')
    act(() => useGeneralSetting.getState().setCurrentLanguage('ja'))
    expect(result.current({ l10n }, '%greet.title%')).toBe('Konnichiwa')
  })
})
