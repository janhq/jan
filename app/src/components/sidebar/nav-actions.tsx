import { HatGlassesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth-store'
import { useRouter } from '@tanstack/react-router'

export function NavActions() {
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const router = useRouter()

  const handleLogin = () => {
    // Add modal=login search param to current route
    const url = new URL(window.location.href)
    url.searchParams.set('modal', 'login')
    router.navigate({ to: url.pathname + url.search })
  }

  if (!isAuthenticated) {
    return (
      <Button size="sm" onClick={handleLogin}>
        Log in
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="data-[state=open]:bg-accent size-7"
    >
      <HatGlassesIcon className="text-muted-foreground" />
    </Button>
  )
}
