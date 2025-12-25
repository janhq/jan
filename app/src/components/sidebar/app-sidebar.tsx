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
import { memo, useEffect, useState } from 'react'
import { Jan } from '@/components/ui/svgs/jan'
import { StaggeredAnimationProvider } from '@/hooks/useStaggeredFadeIn'
import { useProjects } from '@/stores/projects-store'
import { useConversations } from '@/stores/conversation-store'

export const AppSidebar = memo(function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar()
  const isOpen = state === 'expanded'

  const [isReady, setIsReady] = useState(false)
  const getProjects = useProjects((state) => state.getProjects)
  const getConversations = useConversations((state) => state.getConversations)
  const projects = useProjects((state) => state.projects)

  // Calculate animation indices:
  // NavMain: 0, 1, 2 (3 items)
  // NavProjects: starts at 3
  // NavChats: starts after projects (3 + 1 label + N projects, or 3 if no projects)
  const chatsStartIndex = projects.length > 0 ? 3 + 1 + projects.length : 3

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([getProjects(), getConversations()])
      // Wait for next frame to ensure store updates have propagated
      requestAnimationFrame(() => {
        setIsReady(true)
      })
    }
    loadData()
  }, [getProjects, getConversations])

  return (
    <Sidebar className="border-r-0" {...props}>
      <StaggeredAnimationProvider ready={isReady}>
        <SidebarHeader className="pt-3.5 ">
          <div
            className={cn(
              'flex justify-between items-center w-full pl-0.5',
              isOpen && 'pl-2 mb-2'
            )}
          >
            <div className="flex items-center gap-2">
              <Jan className="size-4 shrink-0 block md:hidden" />
              <span className="text-lg font-bold font-studio">Jan</span>
            </div>
            <SidebarTrigger className="text-muted-foreground" />
          </div>
          <NavMain />
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          <NavProjects startIndex={3} />
          <NavChats startIndex={chatsStartIndex} />
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </StaggeredAnimationProvider>
      <SidebarRail />
    </Sidebar>
  )
})
