import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useAppTranslation } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
<<<<<<< HEAD
=======
import { Button } from '@/components/ui/button'
import { ChevronsUpDown } from 'lucide-react'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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
<<<<<<< HEAD
        <span
          title={t('common:changeLanguage')}
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
=======
        <Button variant="outline" size="sm" className="w-full justify-between">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          {LANGUAGES.find(
            (lang: { value: string; label: string }) =>
              lang.value === currentLanguage
          )?.label || t('common:english')}
<<<<<<< HEAD
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
=======
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.value}
            className={cn(
              'cursor-pointer my-0.5',
<<<<<<< HEAD
              currentLanguage === lang.value && 'bg-main-view-fg/5'
=======
              currentLanguage === lang.value && 'bg-secondary-foreground/8'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
