import {
  createRootRoute,
  Outlet,
  useLocation,
  useRouter,
} from '@tanstack/react-router'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { LoginForm } from '@/components/form/login'
import { SettingsDialog } from '@/components/settings/settings-dialog'

function RootLayout() {
  const location = useLocation()
  const router = useRouter()

  // Check if modals should be shown via search params
  const searchParams = new URLSearchParams(location.search)
  const isLoginModal = searchParams.get('modal') === 'login'
  const settingSection = searchParams.get('setting')
  const isSettingsOpen = !!settingSection

  const handleCloseModal = () => {
    // Remove the modal search param by navigating without it
    const url = new URL(window.location.href)
    url.searchParams.delete('modal')
    router.navigate({ to: url.pathname + url.search })
  }

  return (
    <>
      {/* Main content - always rendered */}
      <Outlet />

      {/* Login Modal */}
      <Dialog
        open={isLoginModal}
        onOpenChange={(open: boolean) => !open && handleCloseModal()}
      >
        <DialogContent
          className="sm:max-w-[425px]"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <LoginForm />
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <SettingsDialog open={isSettingsOpen} section={settingSection || 'general'} />
    </>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
