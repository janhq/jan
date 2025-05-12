import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.hub as any)({
  component: Hub,
})

function Hub() {
  const { providers } = useModelProvider()

  console.log(providers)
  return <div className="p-2">Hello from Hub!</div>
}
