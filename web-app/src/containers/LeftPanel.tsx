import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
  IconDots,
  IconCirclePlusFilled,
  IconSettingsFilled,
  IconTrash,
  IconStar,
  IconMessageFilled,
  IconAppsFilled,
  IconX,
  IconSearch,
  IconClipboardSmileFilled,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import ThreadList from './ThreadList'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useThreads } from '@/hooks/useThreads'

import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { DownloadManagement } from '@/containers/DownloadManegement'

const mainMenus = [
  {
    title: 'common.newChat',
    icon: IconCirclePlusFilled,
    route: route.home,
  },
  {
    title: 'Assistants',
    icon: IconClipboardSmileFilled,
    route: route.assistant,
  },
  {
    title: 'common.hub',
    icon: IconAppsFilled,
    route: route.hub,
  },
  {
    title: 'common.settings',
    icon: IconSettingsFilled,
    route: route.settings.general,
  },
]

const LeftPanel = () => {
  const { open, setLeftPanel } = useLeftPanel()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')

  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  const { deleteAllThreads, unstarAllThreads, getFilteredThreads, threads } =
    useThreads()

  const filteredThreads = useMemo(() => {
    return getFilteredThreads(searchTerm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, searchTerm, threads])

  // Memoize categorized threads based on filteredThreads
  const favoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => t.isFavorite)
  }, [filteredThreads])

  const unFavoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => !t.isFavorite)
  }, [filteredThreads])

  const [openDropdown, setOpenDropdown] = useState(false)

  return (
    <aside
      className={cn(
        'w-48 shrink-0 rounded-lg m-1.5 mr-0 text-left-panel-fg',
        open
          ? 'opacity-100 visibility-visible'
          : 'w-0 absolute -top-100 -left-100 visibility-hidden'
      )}
    >
      <div className="relative h-10">
        <button
          className="absolute top-1/2 right-0 -translate-y-1/2 z-20"
          onClick={() => setLeftPanel(!open)}
        >
          <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out">
            <IconLayoutSidebar size={18} className="text-left-panel-fg" />
          </div>
        </button>
        {!IS_MACOS && (
          <div className="relative top-1.5 mb-4 mx-1 mt-1 w-[calc(100%-32px)] z-50">
            <IconSearch className="absolute size-4 top-1/2 left-2 -translate-y-1/2 text-left-panel-fg/50" />
            <input
              type="text"
              placeholder={t('common.search')}
              className="w-full pl-7 pr-8 py-1 bg-left-panel-fg/10 rounded text-left-panel-fg focus:outline-none focus:ring-1 focus:ring-left-panel-fg/10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-left-panel-fg/70 hover:text-left-panel-fg"
                onClick={() => setSearchTerm('')}
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col justify-between h-[calc(100%-42px)] mt-0">
        <div className="flex flex-col justify-between h-full">
          {IS_MACOS && (
            <div className="relative mb-4 mx-1 mt-1">
              <IconSearch className="absolute size-4 top-1/2 left-2 -translate-y-1/2 text-left-panel-fg/50" />
              <input
                type="text"
                placeholder={t('common.search')}
                className="w-full pl-7 pr-8 py-1 bg-left-panel-fg/10 rounded text-left-panel-fg focus:outline-none focus:ring-1 focus:ring-left-panel-fg/10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-left-panel-fg/70 hover:text-left-panel-fg"
                  onClick={() => setSearchTerm('')}
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          )}
          <div className="flex flex-col w-full h-full overflow-hidden">
            <div className="h-full overflow-y-auto overflow-x-hidden">
              {favoritedThreads.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold sticky top-0">
                      {t('common.favorites')}
                    </span>
                    <div className="relative">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10">
                            <IconDots
                              size={18}
                              className="text-left-panel-fg/60"
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              unstarAllThreads()
                              toast.success('All Threads Unfavorited', {
                                id: 'unfav-all-threads',
                                description:
                                  'All threads have been removed from your favorites.',
                              })
                            }}
                          >
                            <IconStar size={16} />
                            <span>{t('common.unstarAll')}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="flex flex-col mb-4">
                    <ThreadList
                      threads={favoritedThreads}
                      isFavoriteSection={true}
                    />
                    {favoritedThreads.length === 0 && (
                      <p className="text-xs text-left-panel-fg/50 px-1 font-semibold">
                        {t('chat.status.empty', { ns: 'chat' })}
                      </p>
                    )}
                  </div>
                </>
              )}

              {unFavoritedThreads.length > 0 && (
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold">
                    {t('common.recents')}
                  </span>
                  <div className="relative">
                    <Dialog
                      onOpenChange={(open) => {
                        if (!open) setOpenDropdown(false)
                      }}
                    >
                      <DropdownMenu
                        open={openDropdown}
                        onOpenChange={(open) => setOpenDropdown(open)}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                          >
                            <IconDots
                              size={18}
                              className="text-left-panel-fg/60"
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end">
                          <DialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                            >
                              <IconTrash size={16} />
                              <span>{t('common.deleteAll')}</span>
                            </DropdownMenuItem>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Delete All Threads</DialogTitle>
                              <DialogDescription>
                                All threads will be deleted. This action cannot
                                be undone.
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
                                    deleteAllThreads()
                                    toast.success('Delete All Threads', {
                                      id: 'delete-all-thread',
                                      description:
                                        'All threads have been permanently deleted.',
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Dialog>
                  </div>
                </div>
              )}

              {filteredThreads.length === 0 && searchTerm.length > 0 && (
                <div className="px-1 mt-2">
                  <div className="flex items-center gap-1 text-left-panel-fg/80">
                    <IconSearch size={18} />
                    <h6 className="font-medium text-base">No results found</h6>
                  </div>
                  <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                    We couldn't find any chats matching your search. Try a
                    different keyword.
                  </p>
                </div>
              )}

              {Object.keys(threads).length === 0 && !searchTerm && (
                <>
                  <div className="px-1 mt-2">
                    <div className="flex items-center gap-1 text-left-panel-fg/80">
                      <IconMessageFilled size={18} />
                      <h6 className="font-medium text-base">No threads yet</h6>
                    </div>
                    <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                      Start a new conversation to see your thread history here.
                    </p>
                  </div>
                </>
              )}

              <div className="flex flex-col">
                <ThreadList threads={unFavoritedThreads} />
              </div>
            </div>
          </div>

          <div className="space-y-1 py-1 mt-2">
            {mainMenus.map((menu) => {
              const isActive =
                currentPath.includes(route.settings.index) &&
                menu.route.includes(route.settings.index)
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  className={cn(
                    'flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded',
                    isActive
                      ? 'bg-left-panel-fg/10'
                      : '[&.active]:bg-left-panel-fg/10'
                  )}
                >
                  <menu.icon size={18} className="text-left-panel-fg/70" />
                  <span className="font-medium text-left-panel-fg/90">
                    {t(menu.title)}
                  </span>
                </Link>
              )
            })}
          </div>
          <DownloadManagement />
        </div>
      </div>
    </aside>
  )
}

export default LeftPanel
