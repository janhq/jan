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
import { cn, extractThinkingContent } from '@/lib/utils'
import { useSmallScreen } from '@/hooks/useMediaQuery'

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
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, MouseEvent, useMemo, useState } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { route } from '@/constants/routes'
import { toast } from 'sonner'

const SortableItem = memo(
  ({
    thread,
    variant,
    currentProjectId,
  }: {
    thread: Thread
    variant?: 'default' | 'project'
    currentProjectId?: string
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

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    }
    const toggleFavorite = useThreads((state) => state.toggleFavorite)
    const deleteThread = useThreads((state) => state.deleteThread)
    const renameThread = useThreads((state) => state.renameThread)
    const updateThread = useThreads((state) => state.updateThread)
    const getFolderById = useThreadManagement().getFolderById
    const { folders } = useThreadManagement()
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
    const handleClick = (e: MouseEvent<HTMLDivElement>) => {
      if (openDropdown) {
        e.stopPropagation()
        e.preventDefault()
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
      return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
    }, [thread.title])

    const availableProjects = useMemo(() => {
      return folders
        .filter((f) => {
          // Exclude the current project page we're on
          if (f.id === currentProjectId) return false
          // Exclude the project this thread is already assigned to
          if (f.id === thread.metadata?.project?.id) return false
          return true
        })
        .sort((a, b) => b.updated_at - a.updated_at)
    }, [folders, currentProjectId, thread.metadata?.project?.id])

    const assignThreadToProject = (threadId: string, projectId: string) => {
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
          isActive && 'bg-left-panel-fg/10'
        )}
        onClick={(e) => handleClick(e)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpenDropdown(true)
        }}
      >
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
                        <IconFolder size={16} />
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
    )
  }
)

type ThreadListProps = {
  threads: Thread[]
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
      return (b.updated || 0) - (a.updated || 0)
    })
  }, [threads])

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
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}

export default memo(ThreadList)
