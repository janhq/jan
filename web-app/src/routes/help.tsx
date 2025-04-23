import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.help as any)({
  component: Help,
})

function Help() {
  return <div className="p-2">Hello from Help!</div>
}
