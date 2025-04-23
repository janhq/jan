import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.miniApps as any)({
  component: MiniApps,
})

function MiniApps() {
  return <div className="p-2">Hello from MiniApps!</div>
}
