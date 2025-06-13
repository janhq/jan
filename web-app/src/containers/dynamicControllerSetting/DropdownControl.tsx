import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Dropdown component
type DropdownControlProps = {
  value: string
  options?: Array<{ value: number | string; name: string }>
  onChange: (value: number | string) => void
}

export function DropdownControl({
  value,
  options = [],
  onChange,
}: DropdownControlProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-2 py-1 rounded font-medium cursor-pointer">
        {options.find((option) => option.value === value)?.name || value}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option, optionIndex) => (
          <DropdownMenuItem
            key={optionIndex}
            onClick={() => onChange(option.value)}
          >
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
