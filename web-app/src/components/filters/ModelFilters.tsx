import { useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { IconFilter, IconChevronDown } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

export interface ModelFilterOptions {
  showOnlyDownloaded: boolean
  toolCallingOnly: boolean
  // Future filters can be added here
  // embeddingsOnly: boolean
  // imageGenerationOnly: boolean
}

interface ModelFiltersProps {
  filters: ModelFilterOptions
  onFiltersChange: (filters: ModelFilterOptions) => void
  className?: string
}

export function ModelFilters({
  filters,
  onFiltersChange,
  className,
}: ModelFiltersProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const handleFilterChange = (key: keyof ModelFilterOptions, value: boolean) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    })
  }

  const activeFiltersCount = Object.values(filters).filter(Boolean).length

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={activeFiltersCount > 0 ? `${t('hub:filters')} (${activeFiltersCount} active)` : t('hub:filters')}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          className={cn(
            'flex cursor-pointer items-center gap-2 px-2 py-1 rounded-sm text-sm outline-none text-main-view-fg font-medium relative bg-main-view-fg/15',
            activeFiltersCount > 0 && 'bg-main-view-fg/20 ring-1 ring-main-view-fg/20',
            className
          )}
        >
          <IconFilter size={14} />
          <span className="hidden sm:inline">{t('hub:filters')}</span>
          {activeFiltersCount > 0 && (
            <span className="pointer-events-none absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 bg-primary text-primary-fg text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {activeFiltersCount}
            </span>
          )}
          <IconChevronDown
            size={14}
            className={cn(
              'transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('hub:filterBy')}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Downloaded Models Filter */}
        <DropdownMenuItem
          className="flex items-center justify-between p-3 cursor-pointer"
          onClick={(e) => {
            e.preventDefault()
            handleFilterChange('showOnlyDownloaded', !filters.showOnlyDownloaded)
          }}
        >
          <span className="text-sm">{t('hub:downloaded')}</span>
          <Switch
            checked={filters.showOnlyDownloaded}
            onCheckedChange={(checked) =>
              handleFilterChange('showOnlyDownloaded', checked)
            }
            onClick={(e) => e.stopPropagation()}
          />
        </DropdownMenuItem>

        {/* Tool Calling Filter */}
        <DropdownMenuItem
          className="flex items-center justify-between p-3 cursor-pointer"
          onClick={(e) => {
            e.preventDefault()
            handleFilterChange('toolCallingOnly', !filters.toolCallingOnly)
          }}
        >
          <div className="flex flex-col">
            <span className="text-sm">{t('hub:toolCalling')}</span>
          </div>
          <Switch
            checked={filters.toolCallingOnly}
            onCheckedChange={(checked) =>
              handleFilterChange('toolCallingOnly', checked)
            }
            onClick={(e) => e.stopPropagation()}
          />
        </DropdownMenuItem>

        {/* Clear Filters */}
        {activeFiltersCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="p-3 cursor-pointer text-center justify-center"
              onClick={() =>
                onFiltersChange({
                  showOnlyDownloaded: false,
                  toolCallingOnly: false,
                })
              }
            >
              <span className="text-sm text-muted-foreground">
                {t('hub:clearFilters')}
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
