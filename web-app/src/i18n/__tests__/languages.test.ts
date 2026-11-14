import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../languages'

function setNavigator(languages: string[]) {
  vi.stubGlobal('navigator', {
    language: languages[0],
    languages,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectLanguage', () => {
  it('picks the first supported OS language', () => {
    setNavigator(['fr-FR', 'en-US'])
    expect(detectLanguage()).toBe('fr')
  })

  it('falls back to the next preferred language when unsupported', () => {
    setNavigator(['nl-NL', 'de-AT', 'en-US'])
    expect(detectLanguage()).toBe('de-DE')
  })

  it('maps regional variants onto the shipped bundles', () => {
    setNavigator(['zh-Hant-HK'])
    expect(detectLanguage()).toBe('zh-TW')

    setNavigator(['pt-PT'])
    expect(detectLanguage()).toBe('pt-BR')

    setNavigator(['vi-VN'])
    expect(detectLanguage()).toBe('vn')
  })

  it('uses a bare language tag when no region is present', () => {
    setNavigator(['ja'])
    expect(detectLanguage()).toBe('ja')
  })

  it('defaults to English when nothing matches', () => {
    setNavigator(['nl-NL', 'sv-SE'])
    expect(detectLanguage()).toBe('en')
  })

  it('defaults to English outside a browser', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectLanguage()).toBe('en')
  })
})
