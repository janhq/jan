import type { MenuLocation } from '@janhq/extension-api'
import { IconDots } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  useContributedMenuItems,
  type ContributedMenuItem,
  type MenuContext,
} from './menuItems'
import { useExecuteCommand } from './useExecuteCommand'

interface ContributedMenuItemsProps<L extends MenuLocation> {
  location: L
  context: MenuContext<L>
  /** Draw a separator above the items, for appending to an existing menu. */
  separator?: boolean
}

function Items({
  items,
  onSelect,
}: {
  items: ContributedMenuItem[]
  onSelect: (item: ContributedMenuItem) => void
}) {
  return items.map((item) => (
    <DropdownMenuItem
      key={`${item.extensionId}/${item.commandId}`}
      onSelect={() => onSelect(item)}
    >
      <span className="truncate">{item.title}</span>
      <span className="ml-auto pl-2 text-xs text-muted-foreground truncate">
        {item.extensionName}
      </span>
    </DropdownMenuItem>
  ))
}

/**
 * Extension commands contributed to `location`, rendered as items of the
 * dropdown menu this is placed in. Renders nothing when there are none.
 */
export function ContributedMenuItems<L extends MenuLocation>({
  location,
  context,
  separator,
}: ContributedMenuItemsProps<L>) {
  const items = useContributedMenuItems(location, context)
  const execute = useExecuteCommand()
  if (items.length === 0) return null
  return (
    <>
      {separator && <DropdownMenuSeparator />}
      <Items
        items={items}
        onSelect={(item) =>
          void execute(item.extensionId, item.commandId, context)
        }
      />
    </>
  )
}

/**
 * A "more actions" button opening the commands contributed to `location`,
 * for surfaces that have no menu of their own. Hidden when there are none.
 */
export function ContributedOverflowMenu<L extends MenuLocation>({
  location,
  context,
}: Omit<ContributedMenuItemsProps<L>, 'separator'>) {
  const { t } = useTranslation()
  const items = useContributedMenuItems(location, context)
  const execute = useExecuteCommand()
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('extensions:moreActions')}
          title={t('extensions:moreActions')}
        >
          <IconDots size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <Items
          items={items}
          onSelect={(item) =>
            void execute(item.extensionId, item.commandId, context)
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
