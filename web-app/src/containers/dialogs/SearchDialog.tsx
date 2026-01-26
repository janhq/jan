import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  IconSearch,
  IconMessage,
  IconHistory,
  IconCirclePlus,
  IconFolder,
} from '@tabler/icons-react'
import { useThreads } from '@/hooks/useThreads'
import { localStorageKey } from '@/constants/localStorage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'

const MAX_RECENT_SEARCHES = 5

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentVersion, setRecentVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const threads = useThreads((state) => state.threads)
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setSelectedIndex(0)
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }, [open])

  // Load recent searches from localStorage
  const recentSearches = useMemo(() => {
    if (!open) return []

    const stored = localStorage.getItem(localStorageKey.recentSearches)
    if (!stored) return []

    try {
      const threadIds = JSON.parse(stored) as string[]
      return threadIds
        .map((id) => threads[id])
        .filter((thread): thread is Thread => thread !== undefined)
        .slice(0, MAX_RECENT_SEARCHES)
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, threads, recentVersion])

  const handleClearRecent = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    localStorage.removeItem(localStorageKey.recentSearches)
    setRecentVersion((v) => v + 1)
  }

  const handleClose = () => {
    setSearchQuery('')
    onOpenChange(false)
  }

  const handleSelectThread = (threadId: string) => {
    // Save to recent searches
    const stored = localStorage.getItem(localStorageKey.recentSearches)
    let threadIds: string[] = []

    if (stored) {
      try {
        threadIds = JSON.parse(stored) as string[]
      } catch {
        threadIds = []
      }
    }

    // Remove if already exists and add to front
    threadIds = threadIds.filter((id) => id !== threadId)
    threadIds.unshift(threadId)

    // Keep only MAX_RECENT_SEARCHES
    threadIds = threadIds.slice(0, MAX_RECENT_SEARCHES)

    localStorage.setItem(
      localStorageKey.recentSearches,
      JSON.stringify(threadIds)
    )

    handleClose()
    navigate({ to: route.threadsDetail, params: { threadId } })
  }

  // Filter and group threads based on search query
  const searchResults = useMemo(() => {
    if (!searchQuery) return { withProject: [], withoutProject: [] }

    const filteredThreads = getFilteredThreads(searchQuery)
    const withProject: Array<{
      thread: Thread
      projectName: string
    }> = []
    const withoutProject: Thread[] = []

    filteredThreads.forEach((thread) => {
      const projectName = thread.metadata?.project?.name
      if (projectName) {
        withProject.push({ thread, projectName })
      } else {
        withoutProject.push(thread)
      }
    })

    return { withProject, withoutProject }
  }, [searchQuery, getFilteredThreads])

  // Calculate all selectable items for keyboard navigation
  const allItems = useMemo(() => {
    const items: Array<{ type: 'new' | 'recent' | 'result'; id: string }> = []

    if (!searchQuery) {
      // Start new chat option
      items.push({ type: 'new', id: 'new-chat' })
      // Recent searches
      recentSearches.forEach((thread) => {
        items.push({ type: 'recent', id: thread.id })
      })
    } else {
      // Search results with project
      searchResults.withProject.forEach(({ thread }) => {
        items.push({ type: 'result', id: thread.id })
      })
      // Search results without project
      searchResults.withoutProject.forEach((thread) => {
        items.push({ type: 'result', id: thread.id })
      })
    }

    return items
  }, [searchQuery, recentSearches, searchResults])

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [allItems.length])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selectedItem = allItems[selectedIndex]
      if (selectedItem) {
        if (selectedItem.type === 'new') {
          handleStartNewChat()
        } else {
          handleSelectThread(selectedItem.id)
        }
      }
    }
  }

  const handleStartNewChat = () => {
    handleClose()
    navigate({ to: '/' })
  }

  const showStartNewChat = !searchQuery
  const hasResults =
    searchResults.withProject.length > 0 ||
    searchResults.withoutProject.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>{t('common:search')}</DialogTitle>
        </VisuallyHidden>

        {/* Search Input */}
        <div className="flex items-center border-b border-main-view-fg/10 px-3">
          <IconSearch className="size-4 text-main-view-fg/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t('common:searchThreads')}
            className="flex-1 h-12 px-3 bg-transparent text-main-view-fg placeholder:text-main-view-fg/50 focus:outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto px-1 py-2">
          {/* Empty state when searching */}
          {searchQuery && !hasResults && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <IconSearch className="size-6 text-main-view-fg/50 mb-2" />
              <h3 className="text-base font-medium mb-1">
                {t('common:noResultsFound')}
              </h3>
              <p className="text-xs leading-relaxed text-main-view-fg/60 w-1/2 mx-auto">
                {t('common:noResultsFoundDesc')}
              </p>
            </div>
          )}

          {/* Start new chat - shown when no search query */}
          {showStartNewChat && (
            <div className="p-1">
              <button
                onClick={handleStartNewChat}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-main-view-fg/5 transition-colors cursor-pointer',
                  selectedIndex === 0 && 'bg-main-view-fg/5'
                )}
              >
                <IconCirclePlus className="size-4 text-main-view-fg/70" />
                <span className="text-sm">{t('common:newChat')}</span>
              </button>
            </div>
          )}

          {/* Recent searches - shown when search is empty */}
          {!searchQuery && recentSearches.length > 0 && (
            <div className="p-1">
              <div className="px-3 pt-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-main-view-fg/50">
                  {t('common:recents')}
                </span>
                <button
                  onClick={handleClearRecent}
                  className="text-xs text-main-view-fg/50 hover:text-main-view-fg transition-colors cursor-pointer"
                >
                  {t('common:clearRecent')}
                </button>
              </div>
              {recentSearches.map((thread, index) => {
                const itemIndex = 1 + index // +1 for new chat option
                return (
                  <button
                    key={thread.id}
                    onClick={() => handleSelectThread(thread.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-main-view-fg/5 transition-colors cursor-pointer',
                      selectedIndex === itemIndex && 'bg-main-view-fg/5'
                    )}
                  >
                    <IconHistory className="size-4 text-main-view-fg/70 shrink-0" />
                    <span className="text-sm truncate">{thread.title}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Search results with project name */}
          {searchQuery && searchResults.withProject.length > 0 && (
            <div className="p-1">
              {searchResults.withProject.map(({ thread, projectName }, index) => {
                const itemIndex = index
                return (
                  <button
                    key={thread.id}
                    onClick={() => handleSelectThread(thread.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-main-view-fg/5 transition-colors cursor-pointer',
                      selectedIndex === itemIndex && 'bg-main-view-fg/5'
                    )}
                  >
                    <IconMessage className="size-4 text-main-view-fg/70 shrink-0" />
                    <div className="flex items-center min-w-0">
                      <span className="text-xs text-main-view-fg/50 flex items-center gap-1">
                        <IconFolder className="size-3" />
                        {projectName} -&nbsp;
                      </span>
                      <span className="text-sm truncate">{thread.title}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Search results without project name */}
          {searchQuery && searchResults.withoutProject.length > 0 && (
            <div className="p-1">
              {searchResults.withoutProject.map((thread, index) => {
                const itemIndex =
                  searchResults.withProject.length + index
                return (
                  <button
                    key={thread.id}
                    onClick={() => handleSelectThread(thread.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-main-view-fg/5 transition-colors cursor-pointer',
                      selectedIndex === itemIndex && 'bg-main-view-fg/5'
                    )}
                  >
                    <IconMessage className="size-4 text-main-view-fg/70 shrink-0" />
                    <span className="text-sm truncate">{thread.title}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between border-t border-main-view-fg/10 px-3 py-2 text-xs text-main-view-fg/50">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 rounded text-[10px]">
                ↑↓
              </kbd>
              {t('common:toNavigate')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 rounded text-[10px]">
                ↵
              </kbd>
              {t('common:toSelect')}
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-main-view-fg/10 rounded text-[10px]">
              esc
            </kbd>
            {t('common:toClose')}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
