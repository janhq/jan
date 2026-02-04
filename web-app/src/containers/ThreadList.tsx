<<<<<<< HEAD
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  IconDots,
  IconStarFilled,
  IconStar,
  IconFolder,
  IconX,
  IconTrash,
} from '@tabler/icons-react'
import { useThreads } from '@/hooks/useThreads'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useMessages } from '@/hooks/useMessages'
import { useThreadSelection } from '@/hooks/useThreadSelection'
import { cn, extractThinkingContent } from '@/lib/utils'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { Checkbox } from '@/components/ui/checkbox'
=======
import { Folder, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useRef } from 'react'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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
<<<<<<< HEAD
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, MouseEvent, useMemo, useState } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { route } from '@/constants/routes'
import { toast } from 'sonner'
import { ProjectIcon } from '@/components/ProjectIcon'

const SortableItem = memo(
  ({
    thread,
    variant,
    currentProjectId,
    allThreadIds,
  }: {
    thread: Thread
    variant?: 'default' | 'project'
    currentProjectId?: string
    allThreadIds?: string[]
  }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: thread.id, disabled: true })

    const isSmallScreen = useSmallScreen()
    const setLeftPanel = useLeftPanel((state) => state.setLeftPanel)
    const { isSelectionMode, isSelected, toggleThread } = useThreadSelection()
    const threadIsSelected = isSelected(thread.id)

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    }
    const toggleFavorite = useThreads((state) => state.toggleFavorite)
=======
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ThreadMessage } from '@janhq/core'

const ThreadItem = memo(
  ({
    thread,
    isMobile,
    currentProjectId,
  }: {
    thread: Thread
    isMobile: boolean
    currentProjectId?: string
  }) => {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    const deleteThread = useThreads((state) => state.deleteThread)
    const renameThread = useThreads((state) => state.renameThread)
    const updateThread = useThreads((state) => state.updateThread)
    const getFolderById = useThreadManagement().getFolderById
    const { folders } = useThreadManagement()
<<<<<<< HEAD
    const getMessages = useMessages((state) => state.getMessages)
    const { t } = useTranslation()
    const [openDropdown, setOpenDropdown] = useState(false)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const navigate = useNavigate()
    // Check if current route matches this thread's detail page
    const matches = useMatches()
    const isActive = matches.some(
      (match) =>
        match.routeId === '/threads/$threadId' &&
        'threadId' in match.params &&
        match.params.threadId === thread.id
    )
    const projectsEnabled = PlatformFeatures[PlatformFeature.PROJECTS]

    const handleClick = (e: MouseEvent<HTMLDivElement>) => {
      if (openDropdown) {
        e.stopPropagation()
        e.preventDefault()
        return
      }

      // Handle selection mode
      if (isSelectionMode) {
        e.stopPropagation()
        e.preventDefault()
        toggleThread(thread.id, e.shiftKey, allThreadIds || [])
        return
      }

      if (!isDragging) {
        // Only close panel and navigate if the thread is not already active
        if (!isActive) {
          if (isSmallScreen) setLeftPanel(false)
          navigate({ to: route.threadsDetail, params: { threadId: thread.id } })
        }
      }
    }

    const plainTitleForRename = useMemo(() => {
      // Basic HTML stripping for simple span tags.
      // If thread.title is undefined or null, treat as empty string before replace.
=======
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
      if (currentMessages.length > 0) {
        setLocalMessages(currentMessages)
        messagesLengthRef.current = currentMessages.length
        return
      }

      if (!messagesLoadedRef.current) {
        messagesLoadedRef.current = true
        serviceHub
          .messages()
          .fetchMessages(thread.id)
          .then((fetchedMessages) => {
            if (fetchedMessages) {
              setMessages(thread.id, fetchedMessages)
              setLocalMessages(fetchedMessages)
              messagesLengthRef.current = fetchedMessages.length
            }
          })
          .catch(() => {
            messagesLoadedRef.current = false
          })
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
    }, [thread.title])

    const availableProjects = useMemo(() => {
<<<<<<< HEAD
      if (!projectsEnabled) {
        return []
      }
      return folders
        .filter((f) => {
          // Exclude the current project page we're on
          if (f.id === currentProjectId) return false
          // Exclude the project this thread is already assigned to
=======
      return folders
        .filter((f) => {
          if (f.id === currentProjectId) return false
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          if (f.id === thread.metadata?.project?.id) return false
          return true
        })
        .sort((a, b) => b.updated_at - a.updated_at)
<<<<<<< HEAD
    }, [
      projectsEnabled,
      folders,
      currentProjectId,
      thread.metadata?.project?.id,
    ])

    const assignThreadToProject = (threadId: string, projectId: string) => {
      if (!projectsEnabled) {
        return
      }

=======
    }, [folders, currentProjectId, thread.metadata?.project?.id])

    const assignThreadToProject = (threadId: string, projectId: string) => {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      const project = getFolderById(projectId)
      if (project && updateThread) {
        const projectMetadata = {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
        }

        updateThread(threadId, {
          metadata: {
            ...thread.metadata,
            project: projectMetadata,
          },
        })

        toast.success(`Thread assigned to "${project.name}" successfully`)
      }
    }

<<<<<<< HEAD
    const getLastMessageInfo = useMemo(() => {
      const messages = getMessages(thread.id)
      if (messages.length === 0) return null

      const lastMessage = messages[messages.length - 1]
      return {
        date: new Date(lastMessage.created_at || 0),
        content: lastMessage.content?.[0]?.text?.value || '',
      }
    }, [getMessages, thread.id])

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          'rounded hover:bg-left-panel-fg/10 flex items-center justify-between gap-2 px-1.5 group/thread-list transition-all',
          variant === 'project'
            ? 'mb-2 rounded-lg px-4 border border-main-view-fg/10 bg-main-view-fg/5'
            : 'mb-1',
          isDragging ? 'cursor-move' : 'cursor-pointer',
          isActive && !threadIsSelected && 'bg-left-panel-fg/10',
          threadIsSelected && 'bg-primary/10 ring-2 ring-primary/30'
        )}
        onClick={(e) => handleClick(e)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpenDropdown(true)
        }}
      >
        {/* Selection Checkbox */}
        {isSelectionMode && (
          <div
            className="flex items-center pr-2"
            onClick={(e) => {
              e.stopPropagation()
              toggleThread(thread.id, e.shiftKey, allThreadIds || [])
            }}
          >
            <Checkbox
              checked={threadIsSelected}
              onCheckedChange={() => {
                toggleThread(thread.id, false, allThreadIds || [])
              }}
              aria-label={t('common:selectThread', {
                defaultValue: 'Select thread',
              })}
            />
          </div>
        )}

        <div
          className={cn(
            'pr-2 truncate flex-1',
            variant === 'project' ? 'py-2 cursor-pointer' : 'py-1'
          )}
        >
          <span>{thread.title || t('common:newThread')}</span>
          {variant === 'project' && getLastMessageInfo?.content && (
            <span className="block text-sm text-main-view-fg/60 mt-0.5 truncate">
              {extractThinkingContent(getLastMessageInfo.content)}
            </span>
          )}
        </div>
        <div className="flex items-center">
          <DropdownMenu
            open={openDropdown}
            onOpenChange={(open) => setOpenDropdown(open)}
          >
            <DropdownMenuTrigger asChild>
              <IconDots
                size={14}
                className={cn(
                  'text-left-panel-fg/60 shrink-0 cursor-pointer px-0.5 -mr-1 data-[state=open]:bg-left-panel-fg/10 rounded group-hover/thread-list:data-[state=closed]:size-5 size-5 data-[state=closed]:size-0',
                  variant === 'project' && 'text-main-view-fg/60'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="min-w-44">
              {thread.isFavorite ? (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(thread.id)
                  }}
                >
                  <IconStarFilled />
                  <span>{t('common:unstar')}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(thread.id)
                  }}
                >
                  <IconStar />
                  <span>{t('common:star')}</span>
                </DropdownMenuItem>
              )}
              <RenameThreadDialog
                thread={thread}
                plainTitleForRename={plainTitleForRename}
                onRename={renameThread}
                onDropdownClose={() => setOpenDropdown(false)}
              />

              {projectsEnabled && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <IconFolder size={16} />
                    <span>{t('common:projects.addToProject')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-60 min-w-44 overflow-y-auto">
                    {availableProjects.length === 0 ? (
                      <DropdownMenuItem disabled>
                        <span className="text-left-panel-fg/50">
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
                          <ProjectIcon
                            icon={folder.icon}
                            color={folder.color}
                            size="sm"
                            className="shrink-0"
                          />
                          <span className="truncate max-w-[200px]">
                            {folder.name}
                          </span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {projectsEnabled && thread.metadata?.project && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      // Remove project from metadata
                      const projectName = thread.metadata?.project?.name
                      updateThread(thread.id, {
                        metadata: {
                          ...thread.metadata,
                          project: undefined,
                        },
                      })
                      toast.success(
                        `Thread removed from "${projectName}" successfully`
                      )
                    }}
                  >
                    <IconX size={16} />
                    <span>Remove from project</span>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDeleteConfirmOpen(true)
                  setOpenDropdown(false)
                }}
              >
                <IconTrash />
                <span>{t('common:delete')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DeleteThreadDialog
            thread={thread}
            onDelete={deleteThread}
            onDropdownClose={() => setOpenDropdown(false)}
            variant={variant}
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            withoutTrigger
          />
        </div>
      </div>
=======
    return (
      <SidebarMenuItem>
        {currentProjectId ? 
        <Link to="/threads/$threadId" params={{ threadId: thread.id }} className="bg-secondary dark:bg-secondary/20 px-4 py-4 hover:bg-secondary/30 rounded-lg block">
            <span>{thread.title || t('common:newThread')}</span>
            {currentProjectId && lastUserMessageText && (
              <div className="text-muted-foreground text-xs mt-1 line-clamp-1 pr-10">
                {lastUserMessageText}
              </div>
            )}
        </Link>
        : 
        <SidebarMenuButton asChild>
          <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
            <span>{thread.title || t('common:newThread')}</span>
          </Link>
        </SidebarMenuButton>
        }
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              className={cn("hover:bg-sidebar-foreground/8", currentProjectId && 'mt-4 mr-2')}
            >
              <MoreHorizontal />
              <span className="sr-only">More</span>
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
                    updateThread(thread.id, {
                      metadata: {
                        ...thread.metadata,
                        project: undefined,
                      },
                    })
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
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                setDeleteConfirmOpen(true)
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
          onRename={renameThread}
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    )
  }
)

type ThreadListProps = {
  threads: Thread[]
<<<<<<< HEAD
  isFavoriteSection?: boolean
  variant?: 'default' | 'project'
  showDate?: boolean
  currentProjectId?: string
}

function ThreadList({
  threads,
  variant = 'default',
  currentProjectId,
}: ThreadListProps) {
  const sortedThreads = useMemo(() => {
    return threads.sort((a, b) => {
=======
  currentProjectId?: string
}

function ThreadList({ threads, currentProjectId }: ThreadListProps) {
  const { isMobile } = useSidebar()

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      return (b.updated || 0) - (a.updated || 0)
    })
  }, [threads])

<<<<<<< HEAD
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}>
      <SortableContext
        items={sortedThreads.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        {sortedThreads.map((thread, index) => (
          <SortableItem
            key={index}
            thread={thread}
            variant={variant}
            currentProjectId={currentProjectId}
            allThreadIds={sortedThreads.map((t) => t.id)}
          />
        ))}
      </SortableContext>
    </DndContext>
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  )
}

export default memo(ThreadList)
