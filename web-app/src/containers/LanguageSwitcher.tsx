import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useTranslation } from 'react-i18next'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Bahasa' },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const { setCurrentLanguage } = useGeneralSetting()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
    setCurrentLanguage(lng as Language)
  }

  return (
    <div>
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => changeLanguage(lang.code)}
          disabled={i18n.language === lang.code}
          style={{
            marginRight: '0.5rem',
            fontWeight: i18n.language === lang.code ? 'bold' : 'normal',
          }}
        >
          {lang.label}
        </button>
      ))}
    </div>
  )
}
