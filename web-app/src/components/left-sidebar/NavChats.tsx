import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar"
import { useMemo } from "react"
import { useThreads } from "@/hooks/useThreads"
import ThreadList from "@/containers/ThreadList"

export function NavChats() {
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)

  const threadsWithoutProject = useMemo(() => {
    return getFilteredThreads('').filter((thread) => !thread.metadata?.project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, threads])

  if (threadsWithoutProject.length === 0) {
    return null
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarMenu>
        <ThreadList threads={threadsWithoutProject} />
      </SidebarMenu>
    </SidebarGroup>
  )
}
