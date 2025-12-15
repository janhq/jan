import { NavChats } from '@/components/sidebar/nav-chat'
import { NavMain } from '@/components/sidebar/nav-main'
import { NavProjects } from '@/components/sidebar/nav-projects'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  useSidebar,
  SidebarTrigger,
  SidebarFooter,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { NavUser } from '@/components/sidebar/nav-user'
import { usePrivateChat } from '@/stores/private-chat-store'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar()
  const isOpen = state === 'expanded'
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)

  if (isPrivateChat) {
    return null
  }

  return (
    <Sidebar className="border-r-0" {...props}>
      <SidebarHeader className="pt-3.5 ">
        <div
          className={cn(
            'flex justify-between items-center w-full pl-0.5',
            isOpen && 'pl-2 mb-2'
          )}
        >
          <span className="text-lg font-bold font-studio">Jan</span>
          <SidebarTrigger className="text-muted-foreground" />
        </div>
        <NavMain />
      </SidebarHeader>
      <SidebarContent className="mask-b-from-95% mask-t-from-98%">
        <NavProjects />
        <NavChats />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
