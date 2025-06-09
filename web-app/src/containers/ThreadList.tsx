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
import { Input } from '@/components/ui/input'

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
  const { toggleFavorite, deleteThread, renameThread } = useThreads()
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

  const plainTitleForRename = useMemo(() => {
    // Basic HTML stripping for simple span tags.
    // If thread.title is undefined or null, treat as empty string before replace.
    return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
  }, [thread.title])

  const [title, setTitle] = useState(plainTitleForRename || 'New Thread')

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
        <span
          dangerouslySetInnerHTML={{ __html: thread.title || 'New Thread' }}
        />
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
            <Dialog
              onOpenChange={(open) => {
                if (!open) {
                  setOpenDropdown(false)
                  setTitle(plainTitleForRename || 'New Thread')
                }
              }}
            >
              <DialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <IconEdit />
                  <span>{t('common.rename')}</span>
                </DropdownMenuItem>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Thread Title</DialogTitle>
                  <Input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value)
                    }}
                    className="mt-2"
                    onKeyDown={(e) => {
                      // Prevent key from being captured by parent components
                      e.stopPropagation()
                    }}
                  />
                  <DialogFooter className="mt-2 flex items-center">
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
                      disabled={!title}
                      onClick={() => {
                        renameThread(thread.id, title)
                        setOpenDropdown(false)
                        toast.success('Rename Thread', {
                          id: 'rename-thread',
                          description:
                            "Thread title has been renamed to '" + title + "'",
                        })
                      }}
                    >
                      Rename
                    </Button>
                  </DialogFooter>
                </DialogHeader>
              </DialogContent>
            </Dialog>

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
                  <DialogFooter className="mt-2 flex items-center">
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
                      onClick={() => {
                        deleteThread(thread.id)
                        setOpenDropdown(false)
                        toast.success('Delete Thread', {
                          id: 'delete-thread',
                          description:
                            'This thread has been permanently deleted.',
                        })
                        setTimeout(() => {
                          navigate({ to: route.home })
                        }, 0)
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

function ThreadList({ threads }: ThreadListProps) {
  const { setThreads } = useThreads()

  const sortedThreads = useMemo(() => {
    return threads.sort((a, b) => {
      // If both have order, sort by order (ascending, so lower order comes first)
      if (a.order != null && b.order != null) {
        return a.order - b.order
      }
      // If only one has order, prioritize the one with order (order comes first)
      if (a.order != null) return -1
      if (b.order != null) return 1
      // If neither has order, sort by updated time (newer threads first)
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event
        if (active.id !== over?.id && over) {
          // Access Global State
          const allThreadsMap = useThreads.getState().threads
          const allThreadsArray = Object.values(allThreadsMap)

          // Calculate Global Indices
          const oldIndexInGlobal = allThreadsArray.findIndex(
            (t) => t.id === active.id
          )
          const newIndexInGlobal = allThreadsArray.findIndex(
            (t) => t.id === over.id
          )

          // Reorder Globally and Update State
          if (oldIndexInGlobal !== -1 && newIndexInGlobal !== -1) {
            const reorderedGlobalThreads = arrayMove(
              allThreadsArray,
              oldIndexInGlobal,
              newIndexInGlobal
            )
            setThreads(reorderedGlobalThreads)
          }
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
