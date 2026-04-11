import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import {
  NOTIFICATION_POSITIONS,
  type NotificationPosition,
} from '@/utils/toastPlacement'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown } from 'lucide-react'

function positionLabelKey(position: NotificationPosition): string {
  switch (position) {
    case 'top-right':
      return 'settings:interface.notificationPositionTopRight'
    case 'top-left':
      return 'settings:interface.notificationPositionTopLeft'
    case 'bottom-right':
      return 'settings:interface.notificationPositionBottomRight'
    case 'bottom-left':
      return 'settings:interface.notificationPositionBottomLeft'
  }
}

export function NotificationPositionSwitcher() {
  const { notificationPosition, setNotificationPosition } =
    useInterfaceSettings()
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          title={t('settings:interface.notificationPosition')}
        >
          {t(positionLabelKey(notificationPosition))}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {NOTIFICATION_POSITIONS.map((value) => (
          <DropdownMenuItem
            key={value}
            className={cn(
              'cursor-pointer my-0.5',
              notificationPosition === value && 'bg-secondary-foreground/8'
            )}
            onClick={() => setNotificationPosition(value)}
          >
            {t(positionLabelKey(value))}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
