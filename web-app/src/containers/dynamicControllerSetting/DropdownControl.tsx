import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { cn } from '@/lib/utils'
import { IconCircleCheck, IconDownload } from '@tabler/icons-react'

// Dropdown component
type DropdownControlProps = {
  value: string
  options?: Array<{
    value: number | string
    name: string
    metadata?: { installed?: boolean }
  }>
  recommended?: string
  onChange: (value: number | string) => void
}

export function DropdownControl({
  value,
  options = [],
  onChange,
}: DropdownControlProps) {
  const isSelected =
    options.find((option) => option.value === value)?.name || value

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-3 py-1 rounded-sm font-medium cursor-pointer">
        {isSelected}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-70">
        {options.map((option, optionIndex) => (
          <DropdownMenuItem
            key={optionIndex}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center justify-between my-1 gap-2',
              isSelected === option.name
                ? 'bg-main-view-fg/6 hover:bg-main-view-fg/6'
                : ''
            )}
          >
            <div className="flex items-center gap-2 flex-1">
              {/* Visual indicator */}
              {option.metadata?.installed ? (
                <IconCircleCheck size={14} className="text-green-500 shrink-0" />
              ) : (
                <IconDownload size={14} className="text-main-view-fg/40 shrink-0" />
              )}
              <span className="truncate">{option.name}</span>
            </div>
            {/* Show badge for installed/available */}
            {option.metadata?.installed ? (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 shrink-0">
                Installed
              </span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded bg-main-view-fg/5 text-main-view-fg/50 shrink-0">
                Available
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
