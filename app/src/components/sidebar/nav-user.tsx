import { ChevronsUpDown, LogOut, SettingsIcon, FlagIcon } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

declare const VITE_REPORT_ISSUE_URL: string
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerLabel,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useAuth } from '@/stores/auth-store'
import { useRouter } from '@tanstack/react-router'
import { getInitialsAvatar } from '@/lib/utils'
import { URL_PARAM, SETTINGS_SECTION } from '@/constants'

export function NavUser() {
  const user = useAuth((state) => state.user)
  const isGuest = useAuth((state) => state.isGuest)
  const logout = useAuth((state) => state.logout)
  const router = useRouter()

  if (!user || isGuest) {
    return null
  }

  const handleOpenSettings = (section: string = SETTINGS_SECTION.GENERAL) => {
    const url = new URL(window.location.href)
    url.searchParams.set(URL_PARAM.SETTING, section)
    router.navigate({ to: url.pathname + url.search })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropDrawer>
          <DropDrawerTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-full">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="bg-primary text-background font-medium">
                  {getInitialsAvatar(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {/* temporary till we have manage billing */}
                  {/* {user.pro ? 'Pro Plan' : 'Free Plan'} */}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropDrawerTrigger>
          <DropDrawerContent
            className="md:w-56"
            side="top"
            align="end"
            sideOffset={4}
          >
            <DropDrawerLabel className="lg:p-0 font-normal">
              <div className="flex items-center gap-2 px-3 py-1.5 text-left text-sm">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground mt-1">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropDrawerLabel>
            <DropDrawerItem
              onClick={() => handleOpenSettings(SETTINGS_SECTION.GENERAL)}
            >
              <div className="flex gap-2 items-center justify-center">
                <SettingsIcon className="text-muted-foreground" />
                Setting
              </div>
            </DropDrawerItem>
            {/* <DropDrawerItem>
                <div className="flex gap-2 items-center justify-center">
                  <CreditCard className="text-muted-foreground" />
                  Manage Plan
                </div>
              </DropDrawerItem> */}
            {/* <DropDrawerItem>
                <div className="flex gap-2 items-center justify-center">
                  <LifeBuoyIcon className="text-muted-foreground" />
                  Support
                </div>
              </DropDrawerItem> */}
            <DropDrawerItem asChild>
              <a
                href={VITE_REPORT_ISSUE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-2 items-center w-full"
              >
                <FlagIcon className="text-muted-foreground" />
                Report Issue
              </a>
            </DropDrawerItem>
            <DropDrawerItem
              onClick={async () => {
                await logout()
                router.navigate({
                  to: '/',
                  replace: true,
                })
              }}
            >
              <div className="flex gap-2 items-center justify-center">
                <LogOut className="text-muted-foreground ml-0.5" />
                Log out
              </div>
            </DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
