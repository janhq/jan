import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown } from 'lucide-react'
import { useTranslation } from '@/i18n'

// Dropdown component
type DropdownControlProps = {
  value: string
  options?: Array<{
    value: number | string
    name: string
    /** Present on backend versions: already on disk, so selecting it is a
     * rollback rather than a download. */
    installed?: boolean
  }>
  recommended?: string
  onChange: (value: number | string) => void
}

export function DropdownControl({
  value,
  options = [],
  onChange,
}: DropdownControlProps) {
  const { t } = useTranslation()
  const isSelected =
    options.find((option) => option.value === value)?.name || value

  if (options.length <= 1) {
    return (
      <div
        className="text-sm text-muted-foreground px-3 py-1.5 max-w-full truncate"
        title={String(isSelected)}
      >
        {isSelected}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between" title={isSelected}>
          <span className='max-w-42 line-clamp-1'>{isSelected}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-70">
        {options.map((option, optionIndex) => (
          <DropdownMenuItem
            key={optionIndex}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center justify-between my-1',
              isSelected === option.name
                ? 'bg-secondary/60 hover:bg-secondary/40'
                : ''
            )}
          >
            <span>{option.name}</span>
            {option.installed && (
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {t('providers:backendInstalled')}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
