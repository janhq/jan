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
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  IconDots,
  IconStarFilled,
  IconTrash,
  IconEdit,
  IconStar,
} from '@tabler/icons-react'
import { useThreads } from '@/hooks/useThreads'
import { cn } from '@/lib/utils'
import { route } from '@/constants/routes'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { memo, useMemo, useState } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { toast } from 'sonner'

const SortableItem = memo(({ thread }: { thread: Thread }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: thread.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const { toggleFavorite, deleteThread } = useThreads()
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
      navigate({ to: route.threadsDetail, params: { threadId: thread.id } })
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={cn(
        'mb-1 rounded hover:bg-left-panel-fg/10 flex items-center justify-between gap-2 px-1.5 group/thread-list transition-all',
        isDragging ? 'cursor-move' : 'cursor-pointer',
        isActive && 'bg-left-panel-fg/10'
      )}
    >
      <div className="py-1 pr-2 truncate">
        <span className="text-left-panel-fg/90">
          {thread.title || 'New Thread'}
        </span>
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
                <span>{t('common.unstar')}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFavorite(thread.id)
                }}
              >
                <IconStar />
                <span>{t('common.star')}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem>
              <IconEdit />
              <span>{t('common.rename')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <Dialog
              onOpenChange={(open) => {
                if (!open) setOpenDropdown(false)
              }}
            >
              <DialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <IconTrash />
                  <span>{t('common.delete')}</span>
                </DropdownMenuItem>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Thread</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete this thread? This action
                    cannot be undone.
                  </DialogDescription>
                  <DialogFooter className="mt-2">
                    <DialogClose asChild>
                      <Button
                        variant="link"
                        size="sm"
                        className="hover:no-underline"
                      >
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        deleteThread(thread.id)
                        navigate({ to: route.home })
                        setOpenDropdown(false)
                        toast.success('Delete Thread', {
                          id: 'delete-thread',
                          description:
                            'This thread has been permanently deleted.',
                        })
                      }}
                    >
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogHeader>
              </DialogContent>
            </Dialog>
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

function ThreadList({ threads, isFavoriteSection = false }: ThreadListProps) {
  const { setThreads, threads: allThreads } = useThreads()

  const sortedThreads = useMemo(() => {
    return Object.values(allThreads).sort((a, b) => {
      if (a.order && b.order) return a.order - b.order

      // Later on top
      return (b.updated || 0) - (a.updated || 0)
    })
  }, [allThreads])

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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event
        if (active.id !== over?.id) {
          const oldIndex = threads.findIndex((t) => t.id === active.id)
          const newIndex = threads.findIndex((t) => t.id === over?.id)

          // Create a new array with the reordered threads from this section only
          const reorderedSectionThreads = arrayMove(threads, oldIndex, newIndex)

          // Split all threads into favorites and non-favorites
          const favThreads = sortedThreads.filter((t) => t.isFavorite)
          const nonFavThreads = sortedThreads.filter((t) => !t.isFavorite)

          // Replace the appropriate section with the reordered threads
          let updatedThreads
          if (isFavoriteSection) {
            // If we're in the favorites section, update favorites and keep non-favorites as is
            updatedThreads = [...reorderedSectionThreads, ...nonFavThreads]
          } else {
            // If we're in the non-favorites section, update non-favorites and keep favorites as is
            updatedThreads = [...favThreads, ...reorderedSectionThreads]
          }

          setThreads(updatedThreads)
        }
      }}
    >
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
