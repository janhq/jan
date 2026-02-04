<<<<<<< HEAD
=======
import { Button } from '@/components/ui/button'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'
<<<<<<< HEAD
=======
import { ChevronsUpDown } from 'lucide-react'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

const hostOptions = [
  { value: '127.0.0.1', label: '127.0.0.1' },
  { value: '0.0.0.0', label: '0.0.0.0' },
]

export function ServerHostSwitcher({
  isServerRunning,
}: {
  isServerRunning?: boolean
}) {
  const { serverHost, setServerHost } = useLocalApiServer()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        className={cn(isServerRunning && 'opacity-50 pointer-events-none')}
      >
<<<<<<< HEAD
        <span
          title="Edit Server Host"
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {serverHost}
        </span>
=======
        <Button variant="outline" size="sm" className="w-full justify-between" title="Edit Server Host">
          {serverHost}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {hostOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
<<<<<<< HEAD
              serverHost === item.value && 'bg-main-view-fg/5'
=======
              serverHost === item.value && 'bg-seconday'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            )}
            onClick={() => setServerHost(item.value as '127.0.0.1' | '0.0.0.0')}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
