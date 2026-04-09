import { describe, expect, it } from 'vitest'
import {
  mapAppUiLanguageToTesseract,
  resolveScreenCaptureOcrLanguages,
  TESSERACT_LANG_AUTO,
} from '@/lib/screenCaptureOcrTesseract'

describe('mapAppUiLanguageToTesseract', () => {
  it('maps known UI languages to Tesseract codes', () => {
    expect(mapAppUiLanguageToTesseract('en')).toBe('eng')
    expect(mapAppUiLanguageToTesseract('ja')).toBe('jpn')
    expect(mapAppUiLanguageToTesseract('zh-CN')).toBe('chi_sim')
    expect(mapAppUiLanguageToTesseract('zh-TW')).toBe('chi_tra')
    expect(mapAppUiLanguageToTesseract('pt-BR')).toBe('por')
    expect(mapAppUiLanguageToTesseract('ct')).toBe('cat')
  })

  it('falls back to eng for unknown UI language', () => {
    expect(mapAppUiLanguageToTesseract('xx')).toBe('eng')
  })
})

describe('resolveScreenCaptureOcrLanguages', () => {
  it('uses app UI language when auto or empty', () => {
    expect(
      resolveScreenCaptureOcrLanguages(TESSERACT_LANG_AUTO, 'ja')
    ).toBe('jpn')
    expect(resolveScreenCaptureOcrLanguages('', 'ja')).toBe('jpn')
    expect(resolveScreenCaptureOcrLanguages('  ', 'de-DE')).toBe('deu')
  })

  it('uses explicit stored codes', () => {
    expect(resolveScreenCaptureOcrLanguages('tha', 'en')).toBe('tha')
    expect(resolveScreenCaptureOcrLanguages('chi_sim+eng', 'en')).toBe(
      'chi_sim+eng'
    )
  })
})
