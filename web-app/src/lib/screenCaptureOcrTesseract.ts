/**
 * Tesseract.js traineddata language codes for screen-capture OCR.
 * @see https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html
 */

export const TESSERACT_LANG_AUTO = 'auto'

/** Single-language presets offered in Settings (multi-lang uses Custom, e.g. chi_sim+eng). */
export const TESSERACT_OCR_PRESET_LANGS = [
  'eng',
  'spa',
  'fra',
  'deu',
  'por',
  'pol',
  'vie',
  'ind',
  'ces',
  'rus',
  'kor',
  'jpn',
  'chi_sim',
  'chi_tra',
  'cat',
] as const

export type TesseractOcrPresetLang = (typeof TESSERACT_OCR_PRESET_LANGS)[number]

/** English labels for the settings dropdown (Tesseract code in parentheses). */
export const TESSERACT_OCR_PRESET_LABELS: Record<TesseractOcrPresetLang, string> = {
  eng: 'English',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  por: 'Portuguese',
  pol: 'Polish',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  ces: 'Czech',
  rus: 'Russian',
  kor: 'Korean',
  jpn: 'Japanese',
  chi_sim: 'Chinese (Simplified)',
  chi_tra: 'Chinese (Traditional)',
  cat: 'Catalan',
}

/** Maps Jan UI language (i18n) to a default Tesseract language pack. */
export function mapAppUiLanguageToTesseract(appUiLanguage: string): string {
  const map: Record<string, string> = {
    en: 'eng',
    es: 'spa',
    fr: 'fra',
    id: 'ind',
    pl: 'pol',
    vn: 'vie',
    'zh-CN': 'chi_sim',
    'zh-TW': 'chi_tra',
    'de-DE': 'deu',
    cs: 'ces',
    'pt-BR': 'por',
    ko: 'kor',
    ja: 'jpn',
    ru: 'rus',
    ct: 'cat',
    ca: 'cat',
  }
  return map[appUiLanguage] ?? 'eng'
}

/**
 * @param stored — From settings: `auto` (follow app UI) or any Tesseract lang string (e.g. `jpn`, `chi_sim+eng`).
 * @param appUiLanguage — `useGeneralSetting` `currentLanguage` when stored is `auto`.
 */
export function resolveScreenCaptureOcrLanguages(
  stored: string,
  appUiLanguage: string
): string {
  const t = stored.trim()
  if (t === '' || t === TESSERACT_LANG_AUTO) {
    return mapAppUiLanguageToTesseract(appUiLanguage)
  }
  return t
}

export const OCR_CUSTOM_SELECT_VALUE = '__custom__'
