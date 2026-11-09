import { Folder, Loader2, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { useThreads } from '@/hooks/useThreads'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { hasCoworkSession } from '@/lib/coworkDelete'
import { isCoworkThread } from '@/lib/threadMode'
import { updateThreadProject } from '@/lib/threadProject'
import { useIsThreadActive } from '@/hooks/useAppState'
import { useChatSessions } from '@/stores/chat-session-store'
import { useMessages } from '@/hooks/useMessages'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useRef } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, useMemo, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ThreadMessage } from '@janhq/core'
import { ContributedMenuItems } from '@/containers/extensions/ContributedMenuItems'

/**
 * A conversation opens in the view that can run it: a Cowork thread in the
 * Cowork view, anything else as a chat. Both routes put the id in the URL, so
 * the row is selected from either param.
 */
function ThreadLink({
  thread,
  ...props
}: { thread: Thread } & Omit<ComponentProps<'a'>, 'href'>) {
  return isCoworkThread(thread) ? (
    <Link to="/cowork/$sessionId" params={{ sessionId: thread.id }} {...props} />
  ) : (
    <Link to="/threads/$threadId" params={{ threadId: thread.id }} {...props} />
  )
}

export const ThreadItem = memo(
  ({
    thread,
    isMobile,
    currentProjectId,
  }: {
    thread: Thread
    isMobile: boolean
    currentProjectId?: string
  }) => {
    const deleteThread = useThreads((state) => state.deleteThread)
    const renameThread = useThreads((state) => state.renameThread)
    const getFolderById = useThreadManagement().getFolderById
    const { folders } = useThreadManagement()
    const { t } = useTranslation()
    const [renameOpen, setRenameOpen] = useState(false)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

    const serviceHub = useServiceHub()
    const getMessages = useMessages((state) => state.getMessages)
    const setMessages = useMessages((state) => state.setMessages)

    // Use a ref to track if messages have been loaded
    const messagesLoadedRef = useRef(false)
    // Track current messages for comparison
    const messagesLengthRef = useRef(0)

    // Get messages reactively via ref tracking (to avoid infinite re-renders)
    const [messages, setLocalMessages] = useState<ThreadMessage[]>(() =>
      getMessages(thread.id)
    )

    // Fetch messages if not loaded yet
    useEffect(() => {
      const currentMessages = getMessages(thread.id)

      // Initial load: no messages yet, fetch them
      if (currentMessages.length === 0 && !messagesLoadedRef.current) {
        messagesLoadedRef.current = true
        serviceHub
          .messages()
          .fetchMessages(thread.id)
          .then((fetchedMessages) => {
            // Only overwrite if the disk actually has content. A brand-new
            // thread starts empty on disk, and racing this against the
            // optimistic addMessage write was wiping the user message.
            if (fetchedMessages && fetchedMessages.length > 0) {
              setMessages(thread.id, fetchedMessages)
              setLocalMessages(fetchedMessages)
              messagesLengthRef.current = fetchedMessages.length
            }
          })
          .catch(() => {
            messagesLoadedRef.current = false
          })
        return
      }

      // Only update local state if messages length changed (prevents re-renders during streaming)
      if (currentMessages.length !== messagesLengthRef.current) {
        setLocalMessages(currentMessages)
        messagesLengthRef.current = currentMessages.length
      }
    }, [thread.id, serviceHub, getMessages, setMessages])

    const lastUserMessageText = useMemo(() => {
      const userMessages = messages.filter((m) => m.role === 'user')
      const lastUserMessage = userMessages[userMessages.length - 1]
      if (!lastUserMessage) return undefined
      const textContent = lastUserMessage.content?.find((c) => c.type === 'text')
      return textContent?.text?.value
    }, [messages])

    const plainTitleForRename = useMemo(() => {
      return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
    }, [thread.title])

    const availableProjects = useMemo(() => {
      return folders
        .filter((f) => {
          if (f.id === currentProjectId) return false
          if (f.id === thread.metadata?.project?.id) return false
          return true
        })
        .sort((a, b) => b.updated_at - a.updated_at)
    }, [folders, currentProjectId, thread.metadata?.project?.id])

    const assignThreadToProject = (threadId: string, projectId: string) => {
      const project = getFolderById(projectId)
      if (project) {
        // Cowork persists from its session, so the move goes through it.
        updateThreadProject(threadId, {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
        })

        toast.success(`Thread assigned to "${project.name}" successfully`)
      }
    }

    const isAppStateActive = useIsThreadActive(thread.id)
    const isSessionStreaming = useChatSessions(
      (state) => state.sessions[thread.id]?.isStreaming ?? false
    )
    const isActive = isAppStateActive || isSessionStreaming

    const currentThreadId = useParams({
      strict: false,
      select: (params) =>
        (params as { threadId?: string; sessionId?: string }).threadId ??
        (params as { sessionId?: string }).sessionId,
    })
    const isSelected = currentThreadId === thread.id
    const onRename = (threadId: string, title: string) => {
      // A live Cowork session owns its title; the mirrored thread follows it.
      if (isCoworkThread(thread) && hasCoworkSession(threadId)) {
        useCoworkSessions.getState().setTitle(threadId, title)
      } else {
        renameThread(threadId, title)
      }
    }

    return (
      <SidebarMenuItem>
        {currentProjectId ?
          <ThreadLink thread={thread} data-testid={`thread-row-${thread.id}`} className={cn("bg-card dark:bg-secondary/20 mb-2 px-4 py-4 border hover:dark:bg-secondary/30 rounded-lg block max-w-full overflow-hidden", isSelected && "border-primary")}>
              <div className="flex items-center gap-1.5 min-w-0">
                {isActive && (
                  <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span className={cn("block truncate", isSelected && "font-medium text-primary")} title={thread.title || t('common:newThread')}>{thread.title || t('common:newThread')}</span>
              </div>
              {currentProjectId && lastUserMessageText && (
                <div className="text-muted-foreground text-xs mt-1 line-clamp-1 pr-10">
                  {lastUserMessageText}
                </div>
              )}
          </ThreadLink>
          :
          <SidebarMenuButton asChild isActive={isSelected} className="data-[active=true]:bg-sidebar-foreground/10 dark:data-[active=true]:bg-sidebar-accent">
            <ThreadLink thread={thread} data-testid={`thread-row-${thread.id}`}>
              {isActive && (
                <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
              )}
              <span className={cn("block truncate", isSelected && "font-medium")} title={thread.title || t('common:newThread')}>{thread.title || t('common:newThread')}</span>
            </ThreadLink>
          </SidebarMenuButton>
        }
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              data-testid={`thread-menu-${thread.id}`}
              showOnHover
              className={cn("hover:bg-sidebar-foreground/8", currentProjectId && 'mt-4 mr-2')}
            >
              <MoreHorizontal />
              <span className="sr-only">{t('common:sidebar.more')}</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-48"
            side={isMobile ? 'bottom' : 'right'}
            align={isMobile ? 'end' : 'start'}
          >
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" />
              <span>{t('common:rename')}</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Folder className="size-4" />
                <span>{t('common:projects.addToProject')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-60 min-w-44 overflow-y-auto">
                {availableProjects.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <span className="text-muted-foreground">
                      {t('common:projects.noProjectsAvailable')}
                    </span>
                  </DropdownMenuItem>
                ) : (
                  availableProjects.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        assignThreadToProject(thread.id, folder.id)
                      }}
                    >
                      <Folder className="size-4" />
                      <span className="truncate max-w-[200px]">
                        {folder.name}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {thread.metadata?.project && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    const projectName = thread.metadata?.project?.name
                    updateThreadProject(thread.id, undefined)
                    toast.success(
                      `Thread removed from "${projectName}" successfully`
                    )
                  }}
                >
                  <X className="size-4" />
                  <span>Remove from project</span>
                </DropdownMenuItem>
              </>
            )}
            <ContributedMenuItems
              location="thread/context"
              context={{ location: 'thread/context', threadId: thread.id }}
              separator
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="thread-delete"
              variant="destructive"
              disabled={thread.title === 'What is Jan?' && !localStorage.getItem('setup-completed')}
              onSelect={() => {
                if (thread.title !== 'What is Jan?' || localStorage.getItem('setup-completed')) {
                  setDeleteConfirmOpen(true)
                }
              }}
            >
              <Trash2 className="size-4" />
              <span>{t('common:delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <RenameThreadDialog
          thread={thread}
          plainTitleForRename={plainTitleForRename}
          onRename={onRename}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          withoutTrigger
        />
        
        <DeleteThreadDialog
          thread={thread}
          onDelete={deleteThread}
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          withoutTrigger
        />
      </SidebarMenuItem>
    )
  }
)

type ThreadListProps = {
  threads: Thread[]
  currentProjectId?: string
}

function ThreadList({ threads, currentProjectId }: ThreadListProps) {
  const { isMobile } = useSidebar()

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      return (b.updated || 0) - (a.updated || 0)
    })
  }, [threads])

  return (
    <>
      {sortedThreads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          isMobile={isMobile}
          currentProjectId={currentProjectId}
        />
      ))}
    </>
  )
}

export default memo(ThreadList)
