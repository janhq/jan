import { useAppTranslation } from './hooks'

// Compatibility layer for react-i18next
// This allows existing code to work without changes

/**
 * Hook that mimics react-i18next's useTranslation hook
 * @param namespace - Optional namespace (not used in our implementation as we handle it in the key)
 * @returns Object with t function and i18n instance
 */
export const useTranslation = (namespace?: string) => {
  const { t, i18n: i18nInstance } = useAppTranslation()
  
  // If namespace is provided, we can prefix keys with it
  const namespacedT = namespace
    ? (key: string, options?: Record<string, unknown>) => {
        // If key already has namespace, use as-is, otherwise prefix with namespace
        const finalKey = key.includes(':') ? key : `${namespace}:${key}`
        return t(finalKey, options)
      }
    : t
  
  return {
    t: namespacedT,
    i18n: i18nInstance,
  }
}

// Export the i18n instance for direct usage
export { default as i18n } from './setup'

// Re-export other utilities
export { TranslationProvider } from './TranslationContext'
export { useAppTranslation } from './hooks'
