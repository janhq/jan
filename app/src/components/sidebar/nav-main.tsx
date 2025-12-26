import { MessageCirclePlusIcon, FolderPenIcon, Search } from 'lucide-react'
import { useRouter } from '@tanstack/react-router'

import { SidebarMenu, useSidebar } from '@/components/ui/sidebar'
import { AnimatedMenuItem, type NavMainItem } from '@/components/sidebar/items'
import { URL_PARAM, URL_PARAM_VALUE } from '@/constants'

export function NavMain() {
  const router = useRouter()

  const handleNewProject = () => {
    const url = new URL(window.location.href)
    url.searchParams.set(URL_PARAM.PROJECTS, URL_PARAM_VALUE.CREATE)
    router.navigate({ to: url.pathname + url.search })
  }

  const handleSearch = () => {
    const url = new URL(window.location.href)
    url.searchParams.set(URL_PARAM.SEARCH, URL_PARAM_VALUE.OPEN)
    router.navigate({ to: url.pathname + url.search })
  }

  const navMain: NavMainItem[] = [
    {
      title: 'New Chat',
      url: '/',
      icon: MessageCirclePlusIcon,
      isActive: false,
    },
    {
      title: 'New Project',
      url: '#',
      icon: FolderPenIcon,
      onClick: handleNewProject,
    },
    {
      title: 'Search',
      url: '#',
      icon: Search,
      onClick: handleSearch,
    },
  ]

  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      {navMain.map((item, index) => (
        <AnimatedMenuItem
          key={item.title}
          item={item}
          isMobile={isMobile}
          setOpenMobile={setOpenMobile}
          index={index}
        />
      ))}
    </SidebarMenu>
  )
}
