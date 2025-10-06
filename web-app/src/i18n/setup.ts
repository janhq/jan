import { localStorageKey } from '@/constants/localStorage'

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
    resources[language][namespace] = (module as { default: { [key: string]: string } }).default || (module as { [key: string]: string })
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
const translate = (key: string, options: Record<string, unknown> = {}): string => {
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
  const getNestedValue = (obj: Record<string, unknown>, path: string): string | undefined => {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' && current !== null && key in current
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
  
  // If still not found, return the key itself
  if (translation === undefined) {
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
      localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify(parsed))
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
