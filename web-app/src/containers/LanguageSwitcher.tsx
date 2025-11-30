import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useAppTranslation } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const LANGUAGES = [
  { value: 'en-US', label: 'English (English)' },
  { value: 'zh-CN', label: 'Chinese Simplified (简体中文)' },
  { value: 'zh-TW', label: 'Chinese Traditional (繁體中文)' },
  { value: 'cs-CZ', label: 'Czech (Čeština)' },
  { value: 'fr-FR', label: 'French (Français)' },
  { value: 'de-DE', label: 'German (Deutsch)' },
  { value: 'id-ID', label: 'Indonesian (Bahasa Indonesia)' },
  { value: 'ja-JP', label: 'Japanese (日本語)' },
  { value: 'pl-PL', label: 'Polish (Polski)' },
  { value: 'pt-BR', label: 'Portuguese Brazilian (Português do Brasil)' },
  { value: 'ru-RU', label: 'Russian (Русский)' },
  { value: 'vi-VN', label: 'Vietnamese (Tiếng Việt)' },
]

export default function LanguageSwitcher() {
  const { i18n, t } = useAppTranslation()
  const { setCurrentLanguage, currentLanguage } = useGeneralSetting()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
    setCurrentLanguage(lng as Language)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          title={t('common:changeLanguage')}
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {LANGUAGES.find(
            (lang: { value: string; label: string }) =>
              lang.value === currentLanguage
          )?.label || t('common:english')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.value}
            className={cn(
              'cursor-pointer my-0.5',
              currentLanguage === lang.value && 'bg-main-view-fg/5'
            )}
            onClick={() => changeLanguage(lang.value)}
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
