import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown } from 'lucide-react'

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
  onChange,
}: DropdownControlProps) {
  const isSelected =
    options.find((option) => option.value === value)?.name || value

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between">
          {isSelected}
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
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
