import { Link, useRouter } from '@tanstack/react-router'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
  IconDots,
  IconCirclePlusFilled,
  IconSettingsFilled,
  IconLifebuoyFilled,
  IconTrash,
  IconStar,
  IconAppsFilled,
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

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const mainMenus = [
  {
    title: 'common.newChat',
    icon: IconCirclePlusFilled,
    route: route.home,
  },
  {
    title: 'common.miniApps',
    icon: IconAppsFilled,
    route: route.miniApps,
  },
]

const secondaryMenus = [
  {
    title: 'common.helpSupport',
    icon: IconLifebuoyFilled,
    route: route.help,
  },
  {
    title: 'common.settings',
    icon: IconSettingsFilled,
    route: route.settings.modelProviders,
  },
]

const LeftPanel = () => {
  const { open, setLeftPanel } = useLeftPanel()
  const { t } = useTranslation()
  const router = useRouter()
  const { threads, fetchThreads, deleteAllThreads, unstarAllThreads } =
    useThreads()

  useEffect(() => {
    fetchThreads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <aside
      className={cn(
        'w-44 shrink-0 rounded-lg m-1.5 mr-0 text-left-panel-fg',
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
          <div className="flex flex-col w-full h-full overflow-hidden">
            <div className="h-full overflow-y-scroll">
              {threads.filter((t) => t.isFavorite === true).length > 0 && (
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
                          <DropdownMenuItem onClick={unstarAllThreads}>
                            <IconStar size={16} className="mr-1" />
                            <span>{t('common.unstarAll')}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="flex flex-col mb-4">
                    <ThreadList
                      threads={threads.filter((t) => t.isFavorite === true)}
                      isFavoriteSection={true}
                    />
                  </div>
                </>
              )}

              {threads.filter((t) => t.isFavorite === false).length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-xs text-left-panel-fg/50 px-1 font-semibold">
                      {t('common.recents')}
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
                          <DropdownMenuItem onClick={deleteAllThreads}>
                            <IconTrash size={16} className="mr-1" />
                            <span>{t('common.deleteAll')}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </>
              )}

              <div className="flex flex-col">
                <ThreadList
                  threads={threads.filter((t) => t.isFavorite === false)}
                  isFavoriteSection={false}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1 py-1 mt-2">
            {secondaryMenus.map((menu) => {
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  className={cn(
                    'flex items-center gap-1.5 cursor-pointer hover:bg-left-panel-fg/10 py-1 px-1 rounded [&.active]:bg-left-panel-fg/10',
                    router.state.location.pathname.includes(menu.route) &&
                      'bg-left-panel-fg/10'
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
