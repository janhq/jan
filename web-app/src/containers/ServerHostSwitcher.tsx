import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { cn } from '@/lib/utils'

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
        <span
          title="Edit Server Host"
          className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
        >
          {serverHost}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {hostOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5',
              serverHost === item.value && 'bg-main-view-fg/5'
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
