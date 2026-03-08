import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useAppTranslation } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown } from 'lucide-react'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'id', label: 'Bahasa' },
  { value: 'pl', label: 'Polski' },
  { value: 'vn', label: 'Tiếng Việt' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'cs', label: 'Čeština' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ja', label: '日本語' },
  { value: 'ru', label: 'Русский' },
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
        <Button variant="outline" size="sm" className="w-full justify-between">
          {LANGUAGES.find(
            (lang: { value: string; label: string }) =>
              lang.value === currentLanguage
          )?.label || t('common:english')}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.value}
            className={cn(
              'cursor-pointer my-0.5',
              currentLanguage === lang.value && 'bg-secondary-foreground/8'
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
