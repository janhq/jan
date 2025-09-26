/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'

import { useModelProvider } from '@/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'

type SearchParams = {
  model?: {
    id: string
    provider: string
  }
}
import DropdownAssistant from '@/containers/DropdownAssistant'
import { useEffect } from 'react'
import { useThreads } from '@/hooks/useThreads'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

export const Route = createFileRoute(route.temporaryChat as any)({
  component: TemporaryChat,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    model: search.model as SearchParams['model'],
  }),
})

function TemporaryChat() {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const search = useSearch({ from: route.temporaryChat as any })
  const selectedModel = search.model
  const { setCurrentThreadId } = useThreads()

  // Conditional to check if there are any valid providers
  // required min 1 api_key or 1 model in llama.cpp or jan provider
  const hasValidProviders = providers.some(
    (provider) =>
      provider.api_key?.length ||
      (provider.provider === 'llamacpp' && provider.models.length) ||
      (provider.provider === 'jan' && provider.models.length)
  )

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  if (!hasValidProviders) {
    return <SetupScreen />
  }

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        {PlatformFeatures[PlatformFeature.ASSISTANTS] && <DropdownAssistant />}
      </HeaderPage>
      <div className="h-full px-4 md:px-8 overflow-y-auto flex flex-col gap-2 justify-center">
        <div className="w-full md:w-4/6 mx-auto">
          <div className="mb-8 text-center">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">
              {t('chat:temporaryChat')}
            </h1>
            <p className="text-main-view-fg/70 text-lg mt-2">
              {t('chat:temporaryChatDescription')}
            </p>
          </div>
          <div className="flex-1 shrink-0">
            <ChatInput
              showSpeedToken={false}
              model={selectedModel}
              initialMessage={true}
            />
          </div>
        </div>
      </div>
    </div>
  )
}