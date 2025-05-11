import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from 'react-i18next'
import DropdownModelProvider from '@/containers/DropdownModelProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.home as any)({
  component: Index,
})

function Index() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col flex-justify-center">
      <HeaderPage>
        <DropdownModelProvider />
      </HeaderPage>
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center">
        <div className="w-4/6 mx-auto">
          <div className="mb-8 text-center">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">
              {t('chat.welcome', { ns: 'chat' })}
            </h1>
            <p className="text-main-view-fg/70 text-lg mt-2">
              {t('chat.description', { ns: 'chat' })}
            </p>
          </div>

          <div className="flex-1 shrink-0">
            <ChatInput isAtBottom={true} />
          </div>
        </div>
      </div>
    </div>
  )
}
