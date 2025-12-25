import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useStaggeredFadeIn } from '@/hooks/useStaggeredFadeIn'

export function AnimatedProjectItem({
  item,
  isActive,
  isMobile,
  onDeleteClick,
  index,
}: {
  item: Project
  isActive: boolean
  isMobile: boolean
  onDeleteClick: (item: Project) => void
  index: number
}) {
  const animation = useStaggeredFadeIn(index)

  return (
    <SidebarMenuItem className={animation.className} style={animation.style}>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link
          to="/projects/$projectId"
          params={{ projectId: item.id }}
          title={item.name}
        >
          <span>{item.name}</span>
        </Link>
      </SidebarMenuButton>
      <DropDrawer>
        <DropDrawerTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal className="text-muted-foreground" />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropDrawerTrigger>
        <DropDrawerContent
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          <DropDrawerItem
            variant="destructive"
            onClick={() => onDeleteClick(item)}
          >
            <div className="flex gap-2 items-center justify-center">
              <Trash2 className="text-destructive" />
              <span>Delete Project</span>
            </div>
          </DropDrawerItem>
        </DropDrawerContent>
      </DropDrawer>
    </SidebarMenuItem>
  )
}
