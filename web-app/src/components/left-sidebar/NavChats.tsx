import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarGroupAction,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAgentMode } from "@/hooks/useAgentMode"
import { route } from "@/constants/routes"
import { TEMPORARY_CHAT_ID } from "@/constants/chat"
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from "@/hooks/useThreads"
import ThreadList from "@/containers/ThreadList"
import { DeleteAllThreadsDialog } from "@/containers/dialogs/DeleteAllThreadsDialog"

const CHATS_SECTION_EXPANDED_KEY = "jan.navChats.sectionExpanded"

export function NavChats() {
  const { t } = useTranslation()
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)
  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const navigate = useNavigate()
  const [isChatsSectionExpanded, setIsChatsSectionExpanded] = useState(() => {
    if (typeof window === "undefined") return true

    try {
      const persisted = localStorage.getItem(CHATS_SECTION_EXPANDED_KEY)
      if (!persisted) return true

      const parsed = JSON.parse(persisted)
      if (typeof parsed !== "boolean") return true

      return parsed
    } catch {
      return true
    }
  })
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const threadsWithoutProject = useMemo(() => {
    return getFilteredThreads('').filter((thread) => !thread.metadata?.project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, threads])

  const handleToggleChatsSection = () => {
    setIsChatsSectionExpanded((previous) => {
      const next = !previous
      localStorage.setItem(CHATS_SECTION_EXPANDED_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleCreateChat = () => {
    useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)
    navigate({ to: route.home })
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('common:chats')}</SidebarGroupLabel>
      <SidebarGroupAction
        className="hover:bg-sidebar-foreground/8"
        onClick={handleToggleChatsSection}
      >
        {isChatsSectionExpanded ? (
          <ChevronDown size={16} />
        ) : (
          <ChevronRight size={16} />
        )}
        <span className="sr-only">Toggle Chats</span>
      </SidebarGroupAction>
      <SidebarGroupAction
        className="right-8 hover:bg-sidebar-foreground/8"
        onClick={handleCreateChat}
      >
        <Plus className="text-muted-foreground" />
        <span className="sr-only">{t("common:newChat")}</span>
      </SidebarGroupAction>

      {isChatsSectionExpanded && threadsWithoutProject.length > 1 && (
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarGroupAction className="right-14 hover:bg-sidebar-foreground/8">
              <MoreHorizontal className="text-muted-foreground" />
              <span className="sr-only">More</span>
            </SidebarGroupAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DeleteAllThreadsDialog
              onDeleteAll={deleteAllThreads}
              onDropdownClose={() => setDropdownOpen(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {isChatsSectionExpanded && <SidebarMenu>
        <ThreadList threads={threadsWithoutProject} />
      </SidebarMenu>}
    </SidebarGroup>
  )
}
