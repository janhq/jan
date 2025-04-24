import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from '@/locales/en/common.json'
import idCommon from '@/locales/id/common.json'
import enChat from '@/locales/en/chat.json'
import idChat from '@/locales/id/chat.json'

import { localStoregeKey } from '@/constants/localStorage'

const stored = localStorage.getItem(localStoregeKey.settingGeneral)
const parsed = stored ? JSON.parse(stored) : {}
const defaultLang = parsed?.state?.currentLanguage

i18n.use(initReactI18next).init({
  resources: {
    en: {
      chat: enChat,
      common: enCommon,
    },
    id: {
      chat: idChat,
      common: idCommon,
    },
  },
  lng: defaultLang,
  fallbackLng: 'en',
  ns: ['chat', 'common'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
