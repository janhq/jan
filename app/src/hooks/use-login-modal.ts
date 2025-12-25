import { useRouter } from '@tanstack/react-router'

export function useLoginModal() {
  const router = useRouter()

  return () => {
    const url = new URL(window.location.href)
    url.searchParams.set('modal', 'login')
    router.navigate({ to: url.pathname + url.search })
  }
}
