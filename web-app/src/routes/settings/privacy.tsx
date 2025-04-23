import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.privacy as any)({
  component: Privacy,
})

function Privacy() {
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">Settings</h1>
      </HeaderPage>
      <div className="flex h-full">
        <div className="flex h-full w-48 shrink-0 px-1.5 pt-3 border-r border-neutral-800">
          <SettingsMenu />
        </div>
        <div className="p-4">
          <div className="bg-neutral-800/40 p-4 rounded-lg text-neutral-300">
            <div className="flex justify-between gap-8">
              <div>
                <h1 className="font-medium text-base mb-4">Analytics</h1>
                <p className="text-neutral-300">
                  By opting in, you help us make Jan better by sharing anonymous
                  data, like feature usage and user counts. Your chats and
                  personal information are never collected.
                </p>
                <p className="mt-2">
                  We prioritize your control over your data. Learn more about
                  our Privacy Policy.
                </p>
                <p className="my-2">
                  To make Jan better, we need to understand how it’s used - but
                  only if you choose to help. You can change your Jan Analytics
                  settings anytime.
                </p>
                <p>
                  Your choice to opt-in or out doesn't change our core privacy
                  promises:
                </p>
                <ul className="list-disc pl-4 space-y-1 mt-4">
                  <li>Your chats are never read</li>
                  <li>No personal information is collected</li>
                  <li>No accounts or logins required</li>
                  <li>We don’t access your files</li>
                  <li>Your chat history and settings stay on your device</li>
                </ul>
              </div>
              <div className="shrink-0">
                <Switch />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
