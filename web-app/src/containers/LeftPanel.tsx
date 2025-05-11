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
  IconAppsFilled,
  IconX,
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

const mainMenus = [
  {
    title: 'common.newChat',
    icon: IconCirclePlusFilled,
    route: route.home,
  },
  {
    title: 'common.hub',
    icon: IconAppsFilled,
    route: route.hub,
  },
]

const secondaryMenus = [
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
        open ? 'block' : 'hidden'
      )}
    >
      <div className="relative h-8">
        <button
          className="absolute top-1/2 right-0 -translate-y-1/2"
          onClick={() => setLeftPanel(!open)}
        >
          <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out">
            <IconLayoutSidebar size={18} className="text-left-panel-fg" />
          </div>
        </button>
      </div>

      <div className="flex flex-col justify-between h-[calc(100%-32px)] mt-0">
        <div className="flex flex-col justify-between h-full">
          <div className="mt-2 mb-4 space-y-1">
            {mainMenus.map((menu) => {
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  className="flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded [&.active]:bg-left-panel-fg/10"
                >
                  <menu.icon size={18} className="text-left-panel-fg/70" />
                  <span className="font-medium text-left-panel-fg/90">
                    {t(menu.title)}
                  </span>
                </Link>
              )
            })}
          </div>
          <div className="relative mb-4 mx-1">
            <input
              type="text"
              placeholder={t('common.search')}
              className="w-full px-2 py-1.5 bg-left-panel-fg/10 rounded text-sm text-left-panel-fg focus:outline-none focus:ring-1 focus:ring-left-panel-fg/30"
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
          <div className="flex flex-col w-full h-full overflow-hidden">
            <div className="h-full overflow-y-auto overflow-x-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold sticky top-0">
                  {t('common.favorites')}
                </span>
                <div className="relative">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10">
                        <IconDots size={18} className="text-left-panel-fg/60" />
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
                        <IconStar size={16} className="mr-1" />
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
                            <IconTrash size={16} className="mr-1" />
                            <span>{t('common.deleteAll')}</span>
                          </DropdownMenuItem>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Thread</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to delete this thread? This
                              action cannot be undone.
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
                                  navigate({ to: route.home })
                                  toast.success('Delete All Thread', {
                                    id: 'delete-thread',
                                    description:
                                      'All thread has been permanently deleted.',
                                  })
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
              <div className="flex flex-col mb-4">
                <ThreadList threads={unFavoritedThreads} />
              </div>
            </div>
          </div>

          <div className="space-y-1 py-1 mt-2">
            {secondaryMenus.map((menu) => {
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
        </div>
      </div>
    </aside>
  )
}

export default LeftPanel
