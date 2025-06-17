import React from 'react'
import { TranslationProvider, useAppTranslation } from './TranslationContext'
import { useTranslation } from './react-i18next-compat'

// Example component using the new useAppTranslation hook
const ExampleWithAppTranslation: React.FC = () => {
  const { t } = useAppTranslation()

  return (
    <div>
      <h1>{t('common:settings')}</h1>
      <p>{t('common:language')}</p>
      <p>{t('settings:general.appVersion')}</p>
    </div>
  )
}

// Example component using the compatibility layer (works with existing code)
const ExampleWithCompatibility: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div>
      <h1>{t('common:settings')}</h1>
      <p>{t('common:language')}</p>
      <p>{t('settings:general.appVersion')}</p>
    </div>
  )
}

// Example with namespace parameter (compatibility layer)
const ExampleWithNamespace: React.FC = () => {
  const { t } = useTranslation('settings')

  return (
    <div>
      <h1>{t('general.appVersion')}</h1>
      <p>{t('appearance.theme')}</p>
    </div>
  )
}

// Example app with provider
const ExampleApp: React.FC = () => {
  return (
    <TranslationProvider>
      <div>
        <ExampleWithAppTranslation />
        <ExampleWithCompatibility />
        <ExampleWithNamespace />
      </div>
    </TranslationProvider>
  )
}

export default ExampleApp
