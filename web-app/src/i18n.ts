// Re-export our custom i18n implementation
export { default } from '@/i18n/setup'

// Re-export compatibility functions for existing code
export { useTranslation } from '@/i18n/react-i18next-compat'
export { useAppTranslation } from '@/i18n/hooks'
export { TranslationProvider } from '@/i18n/TranslationContext'
