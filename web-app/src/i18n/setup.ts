import { localStorageKey } from '@/constants/localStorage'

/* ============================================================================
 * 语言架构约定(翻译者必读)
 * ----------------------------------------------------------------------------
 * 英文(en) 是唯一 "源语言"(source),其他所有语言都以它为基准:
 *   - `fallbackLng` 固定为 'en',某个语言缺 key 时自动回退到英文,不会显示裸 key。
 *   - 新增 UI 文案时,**先加英文(在 src/locales/en/<ns>.json)**,保证 en 永远最完整。
 *
 * 简体中文(zh-CN) 是 "翻译参考"(reference):
 *   - 它是中文语义的基准。繁体(zh-TW)等其他中文变体,以及需要中文语义对照时,
 *     以 zh-CN 的用词为参考转换(而不要从英文重新意译,以免术语不一致)。
 *   - 简/繁转换时以词级优先(如 下载→下載、文件→檔案、设置→設定),避免字级误转。
 *
 * 其他语言(ja/ko/fr/de/... 等)**无需强制全部补全**:
 *   - 缺 key 时由 fallbackLng('en') 兜底,界面不会出现裸 key。
 *   - 因此不必为了"结构完整"而对每个语言机械填充英文——保留本语言已写的译文即可,
 *     未覆盖的部分自然回退英文。
 *
 * 例外(可保留英文、不需翻译的 key):
 *   - 专业术语/参数名(temperature、top_p、Flash Attention 等,与 en 保持一致)
 *   - 品牌名/专有名词(Jan、llama.cpp、Hugging Face、YaRN)
 *   - 占位符/模板变量({{modelId}}、{{count}} 等)
 *   - 键盘按键名(Enter、Shift+Enter——按键名不翻译)
 * ==========================================================================*/

// Types for our i18n implementation
export interface TranslationResources {
  [language: string]: {
    [namespace: string]: {
      [key: string]: string
    }
  }
}

export interface I18nInstance {
  language: string
  fallbackLng: string
  resources: TranslationResources
  namespaces: string[]
  defaultNS: string
  changeLanguage: (lng: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

// Global i18n instance
let i18nInstance: I18nInstance

// Dynamically load locale files
const localeFiles = import.meta.glob('../locales/**/*.json', { eager: true })

const resources: TranslationResources = {}
const namespaces: string[] = []

// Process all locale files
Object.entries(localeFiles).forEach(([path, module]) => {
  // Example path: '../locales/en/common.json' -> language: 'en', namespace: 'common'
  const match = path.match(/\.\.\/locales\/([^/]+)\/([^/]+)\.json/)

  if (match) {
    const [, language, namespace] = match

    // Initialize language object if it doesn't exist
    if (!resources[language]) {
      resources[language] = {}
    }

    // Add namespace to list if it's not already there
    if (!namespaces.includes(namespace)) {
      namespaces.push(namespace)
    }

    // Add namespace resources to language
    resources[language][namespace] =
      (module as { default: { [key: string]: string } }).default ||
      (module as { [key: string]: string })
  }
})

// Get stored language preference
const getStoredLanguage = (): string => {
  try {
    const stored = localStorage.getItem(localStorageKey.settingGeneral)
    const parsed = stored ? JSON.parse(stored) : {}
    return parsed?.state?.currentLanguage || 'en'
  } catch {
    return 'en'
  }
}

// Translation function
const translate = (
  key: string,
  options: Record<string, unknown> = {}
): string => {
  const { language, fallbackLng, resources: res, defaultNS } = i18nInstance

  // Parse key to extract namespace and actual key
  let namespace = defaultNS
  let translationKey = key

  if (key.includes(':')) {
    const parts = key.split(':')
    namespace = parts[0]
    translationKey = parts[1]
  }

  // Helper function to get nested value from object using dot notation
  const getNestedValue = (
    obj: Record<string, unknown>,
    path: string
  ): string | undefined => {
    return path.split('.').reduce((current, key) => {
      return current &&
        typeof current === 'object' &&
        current !== null &&
        key in current
        ? (current as Record<string, unknown>)[key]
        : undefined
    }, obj as unknown) as string | undefined
  }

  // Try to get translation from current language
  let translation = getNestedValue(res[language]?.[namespace], translationKey)

  // Fallback to fallback language if not found
  if (translation === undefined && language !== fallbackLng) {
    translation = getNestedValue(res[fallbackLng]?.[namespace], translationKey)
  }

  // If still not found, fall back to options.defaultValue (rendering-layer
  // translation convention: UI passes the English source string so unlocalised
  // keys degrade to the original text instead of a bare key or "undefined").
  if (translation === undefined) {
    if (options.defaultValue !== undefined) {
      return String(options.defaultValue)
    }
    console.warn(`Translation missing for key: ${key}`)
    return key
  }

  // Handle interpolation
  if (typeof translation === 'string' && options) {
    return translation.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
      return options[variable] !== undefined ? String(options[variable]) : match
    })
  }

  return String(translation)
}

// Change language function
const changeLanguage = (lng: string): void => {
  if (i18nInstance && resources[lng]) {
    i18nInstance.language = lng

    // Update localStorage
    try {
      const stored = localStorage.getItem(localStorageKey.settingGeneral)
      const parsed = stored ? JSON.parse(stored) : { state: {} }
      parsed.state.currentLanguage = lng
      localStorage.setItem(
        localStorageKey.settingGeneral,
        JSON.stringify(parsed)
      )
    } catch (error) {
      console.error('Failed to save language preference:', error)
    }
  }
}

// Initialize i18n instance
const initI18n = (): I18nInstance => {
  const currentLanguage = getStoredLanguage()

  i18nInstance = {
    language: currentLanguage,
    // en 是唯一源语言:任何语言缺 key 都回退到这里(fallbackLng)。
    // 新增文案务必先加进 src/locales/en/<ns>.json,保证英文源永远最完整。
    fallbackLng: 'en',
    resources,
    namespaces,
    defaultNS: 'common',
    changeLanguage,
    t: translate,
  }

  return i18nInstance
}

// Load translations function (for compatibility with reference implementation)
export const loadTranslations = (): void => {
  // Translations are already loaded via import.meta.glob
  // This function exists for compatibility but doesn't need to do anything
  console.log('Translations loaded:', Object.keys(resources))
}

// Initialize and export the i18n instance
const i18n = initI18n()

export default i18n
