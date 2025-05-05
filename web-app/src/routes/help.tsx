import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { EmojiTest } from '@/containers/EmojiTest'

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

      <div className="mt-8">
        <h2 className="text-xl font-bold mb-2">Emoji Test</h2>
        <p className="mb-4">Testing emoji rendering with remark-emoji:</p>
        <EmojiTest />
      </div>
    </div>
  )
}
