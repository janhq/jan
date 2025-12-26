import { MoreHorizontal, Trash2, PencilLine, Loader2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSeparator,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { ProjectsChatInput } from '@/components/chat-input/projects-chat-input'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useStaggeredFadeIn } from '@/hooks/useStaggeredFadeIn'

export function AnimatedChatItem({
  item,
  isActive,
  isMobile,
  setOpenMobile,
  isBusy,
  onRenameClick,
  onDeleteClick,
  onMoveToProject,
  index,
}: {
  item: Conversation
  isActive: boolean
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  isBusy: boolean
  onRenameClick: (item: Conversation) => void
  onDeleteClick: (item: Conversation) => void
  onMoveToProject: (conversationId: string, projectId: string) => void
  index: number
}) {
  const animation = useStaggeredFadeIn(index)

  return (
    <SidebarMenuItem className={animation.className} style={animation.style}>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link
          to="/threads/$conversationId"
          params={{ conversationId: item.id }}
          title={item.title}
          onClick={() => {
            if (isMobile) {
              setOpenMobile(false)
            }
          }}
        >
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {isBusy ? (
        <SidebarMenuAction>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </SidebarMenuAction>
      ) : (
        <DropDrawer>
          <DropDrawerTrigger asChild>
            <SidebarMenuAction showOnHover>
              <MoreHorizontal className="text-muted-foreground" />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropDrawerTrigger>
          <DropDrawerContent
            className="md:w-56"
            side={isMobile ? 'bottom' : 'right'}
            align={isMobile ? 'end' : 'start'}
          >
            <DropDrawerItem onClick={() => onRenameClick(item)}>
              <div className="flex gap-2 items-center justify-center">
                <PencilLine />
                <span>Rename</span>
              </div>
            </DropDrawerItem>
            <ProjectsChatInput
              title="Move to Project"
              currentProjectId={item.project_id}
              onProjectSelect={(projectId) =>
                onMoveToProject(item.id, projectId)
              }
            />
            <DropDrawerSeparator />
            <DropDrawerItem
              variant="destructive"
              onClick={() => onDeleteClick(item)}
            >
              <div className="flex gap-2 items-center justify-center">
                <Trash2 className="text-destructive" />
                <span>Delete</span>
              </div>
            </DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )}
    </SidebarMenuItem>
  )
}
