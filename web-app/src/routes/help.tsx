import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.help as any)({
  component: Help,
})

function Help() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Help</h1>
      <div className="mb-8">
        <p>This is the help page for the application.</p>
      </div>
    </div>
  )
}
