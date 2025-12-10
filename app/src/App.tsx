import { useEffect, useRef } from 'react'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'
import { useAuth } from '@/stores/auth-store'

function PageContent() {
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const isGuest = useAuth((state) => state.isGuest)
  const { setOpen } = useSidebar()
  const prevAuthRef = useRef(isAuthenticated)

  useEffect(() => {
    // Only update sidebar when authentication state changes
    if (prevAuthRef.current !== isAuthenticated) {
      setOpen(isAuthenticated)
      prevAuthRef.current = isAuthenticated
    }
  }, [isAuthenticated, setOpen])

  return (
    <>
      {!isGuest && <AppSidebar />}
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col gap-4 px-4 py-10">
          <div className="bg-muted/80 mx-auto h-24 w-full max-w-3xl rounded-xl" />
          <div className="bg-muted/80 mx-auto h-full w-full max-w-3xl rounded-xl" />
        </div>
      </SidebarInset>
    </>
  )
}

export default function Page() {
  const isAuthenticated = useAuth((state) => state.isAuthenticated)

  return (
    <SidebarProvider defaultOpen={isAuthenticated}>
      <PageContent />
    </SidebarProvider>
  )
}
