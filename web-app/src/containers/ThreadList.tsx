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
} from '@tabler/icons-react'
import { useThreads } from '@/hooks/useThreads'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { useSmallScreen } from '@/hooks/useMediaQuery'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, useMemo, useState } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { route } from '@/constants/routes'

const SortableItem = memo(({ thread }: { thread: Thread }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: thread.id, disabled: true })

  const isSmallScreen = useSmallScreen()
  const setLeftPanel = useLeftPanel(state => state.setLeftPanel)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const toggleFavorite = useThreads((state) => state.toggleFavorite)
  const deleteThread = useThreads((state) => state.deleteThread)
  const renameThread = useThreads((state) => state.renameThread)
  const { t } = useTranslation()
  const [openDropdown, setOpenDropdown] = useState(false)
  const navigate = useNavigate()
  // Check if current route matches this thread's detail page
  const matches = useMatches()
  const isActive = matches.some(
    (match) =>
      match.routeId === '/threads/$threadId' &&
      'threadId' in match.params &&
      match.params.threadId === thread.id
  )

  const handleClick = () => {
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


  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOpenDropdown(true)
      }}
      className={cn(
        'mb-1 rounded hover:bg-left-panel-fg/10 flex items-center justify-between gap-2 px-1.5 group/thread-list transition-all',
        isDragging ? 'cursor-move' : 'cursor-pointer',
        isActive && 'bg-left-panel-fg/10'
      )}
    >
      <div className="py-1 pr-2 truncate">
        <span>{thread.title || t('common:newThread')}</span>
      </div>
      <div className="flex items-center">
        <DropdownMenu
          open={openDropdown}
          onOpenChange={(open) => setOpenDropdown(open)}
        >
          <DropdownMenuTrigger asChild>
            <IconDots
              size={14}
              className="text-left-panel-fg/60 shrink-0 cursor-pointer px-0.5 -mr-1 data-[state=open]:bg-left-panel-fg/10 rounded group-hover/thread-list:data-[state=closed]:size-5 size-5 data-[state=closed]:size-0"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
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

            <DropdownMenuSeparator />
            <DeleteThreadDialog
              thread={thread}
              onDelete={deleteThread}
              onDropdownClose={() => setOpenDropdown(false)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
})

type ThreadListProps = {
  threads: Thread[]
  isFavoriteSection?: boolean
}

function ThreadList({ threads }: ThreadListProps) {
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
          <SortableItem key={index} thread={thread} />
        ))}
      </SortableContext>
    </DndContext>
  )
}

export default memo(ThreadList)
