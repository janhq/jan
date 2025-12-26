import {
  createRootRoute,
  Outlet,
  useLocation,
  useRouter,
} from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { LoginForm } from '@/components/form/login'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { CreateProject } from '@/components/projects/create-project'
import { SearchDialog } from '@/components/search/search-dialog'
import { useAuth } from '@/stores/auth-store'
import { ThemeProvider } from '@/components/themes/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { LOCAL_STORAGE_KEY, THEME, URL_PARAM, URL_PARAM_VALUE, SETTINGS_SECTION } from '@/constants'

function RootLayout() {
  const location = useLocation()
  const router = useRouter()
  const accessToken = useAuth((state) => state.accessToken)
  const guestLogin = useAuth((state) => state.guestLogin)
  const hasAttemptedGuestLogin = useRef(false)

  // Auto guest login if no token exists
  useEffect(() => {
    if (!accessToken && !hasAttemptedGuestLogin.current) {
      hasAttemptedGuestLogin.current = true
      guestLogin().catch((error) => {
        console.error('Auto guest login failed:', error)
        hasAttemptedGuestLogin.current = false // Allow retry on failure
      })
    }
  }, [accessToken, guestLogin])

  // Check if modals should be shown via search params
  const searchParams = new URLSearchParams(location.search)
  const isLoginModal = searchParams.get(URL_PARAM.MODAL) === URL_PARAM_VALUE.LOGIN
  const settingSection = searchParams.get(URL_PARAM.SETTING)
  const isSettingsOpen = !!settingSection
  const projectsSection = searchParams.get(URL_PARAM.PROJECTS)
  const isProjectsOpen = !!projectsSection
  const searchSection = searchParams.get(URL_PARAM.SEARCH)
  const isSearchOpen = !!searchSection

  const handleCloseModal = () => {
    // Remove the modal search param by navigating without it
    const url = new URL(window.location.href)
    url.searchParams.delete(URL_PARAM.MODAL)
    router.navigate({ to: url.pathname + url.search })
  }

  return (
    <ThemeProvider defaultTheme={THEME.SYSTEM} storageKey={LOCAL_STORAGE_KEY.THEME}>
      {/* Main content - always rendered */}
      <Outlet />

      {/* Login Modal */}
      <Dialog
        open={isLoginModal}
        onOpenChange={(open: boolean) => !open && handleCloseModal()}
      >
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <LoginForm />
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        section={settingSection || SETTINGS_SECTION.GENERAL}
      />

      {/* Projects Dialog */}
      <CreateProject open={isProjectsOpen} />

      {/* Search Dialog */}
      <SearchDialog open={isSearchOpen} />

      {/* Toast Notifications */}
      {/* <Toaster position="top-center" /> */}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
