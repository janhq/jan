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
<<<<<<< HEAD
      <DropdownMenuTrigger className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-3 py-1 rounded-sm font-medium cursor-pointer">
        {isSelected}
=======
      <DropdownMenuTrigger >
        <Button variant="outline" size="sm" className="w-full justify-between">
          {isSelected}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-70">
        {options.map((option, optionIndex) => (
          <DropdownMenuItem
            key={optionIndex}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center justify-between my-1',
              isSelected === option.name
<<<<<<< HEAD
                ? 'bg-main-view-fg/6 hover:bg-main-view-fg/6'
=======
                ? 'bg-secondary/60 hover:bg-secondary/40'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
