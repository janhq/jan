import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { IconStarFilled } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

// Dropdown component
type DropdownControlProps = {
  value: string
  options?: Array<{ value: number | string; name: string }>
  recommended?: string
  onChange: (value: number | string) => void
}

export function DropdownControl({
  value,
  options = [],
  recommended,
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
              'flex items-center justify-between my-1',
              isSelected === option.name
                ? 'bg-main-view-fg/6 hover:bg-main-view-fg/6'
                : ''
            )}
          >
            <span>{option.name}</span>
            {recommended === option.value && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-pointer">
                    <IconStarFilled className="text-accent" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} className="z-50">
                  Recommended
                </TooltipContent>
              </Tooltip>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
