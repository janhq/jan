import { HatGlassesIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth-store'
import { useRouter } from '@tanstack/react-router'
import { usePrivateChat } from '@/stores/private-chat-store'

export function NavActions() {
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const isGuest = useAuth((state) => state.isGuest)
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)
  const setIsPrivateChat = usePrivateChat((state) => state.setIsPrivateChat)
  const router = useRouter()

  const handleLogin = () => {
    // Add modal=login search param to current route
    const url = new URL(window.location.href)
    url.searchParams.set('modal', 'login')
    router.navigate({ to: url.pathname + url.search })
  }

  if (!isAuthenticated || isGuest) {
    return (
      <Button size="sm" onClick={handleLogin}>
        Log in
      </Button>
    )
  }

  return (
    <>
      {isPrivateChat ? (
        <>
          <div
            className="
              hidden md:block fixed top-0 left-1/2 -translate-x-1/2 z-10
              h-12 bg-foreground
              rounded-2xl rounded-t-none
              pointer-events-none
  "
          >
            <div className="bg-foreground fixed size-4 -left-4 top-0">
              <div className="absolute top-0 left-0 w-4 h-4 bg-background rounded-tr-full" />
            </div>
            <div className="flex h-full items-center justify-center gap-2 px-4 text-background pointer-events-auto">
              <HatGlassesIcon className="size-4" />
              Private
            </div>
            <div className="bg-foreground fixed size-4 -right-4 top-0">
              <div className="absolute top-0 right-0 w-4 h-4 bg-background rounded-tl-full" />
            </div>
          </div>
          <Button
            variant="destructive"
            className="rounded-full"
            onClick={() => {
              setIsPrivateChat(false)
              router.navigate({ to: '/' })
            }}
          >
            <span className="hidden md:flex">End Chat</span>
            <XIcon className="size-3.5" />
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            setIsPrivateChat(true)
            router.navigate({ to: '/' })
          }}
        >
          <HatGlassesIcon className="text-muted-foreground" />
        </Button>
      )}
    </>
  )
}
