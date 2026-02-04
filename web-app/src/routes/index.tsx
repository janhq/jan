/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
<<<<<<< HEAD
import { predefinedProviders } from '@/consts/providers'
=======
import { predefinedProviders } from '@/constants/providers'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

type SearchParams = {
  'model'?: {
    id: string
    provider: string
  }
<<<<<<< HEAD
  'temporary-chat'?: boolean
}
import DropdownAssistant from '@/containers/DropdownAssistant'
import { useEffect } from 'react'
import { useThreads } from '@/hooks/useThreads'
import { useMobileScreen } from '@/hooks/useMediaQuery'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
=======
}
import { useEffect } from 'react'
import { useThreads } from '@/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

export const Route = createFileRoute(route.home as any)({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const result: SearchParams = {
      model: search.model as SearchParams['model'],
    }

<<<<<<< HEAD
    // Only include temporary-chat if it's explicitly true
    if (
      search[TEMPORARY_CHAT_QUERY_ID] === 'true' ||
      search[TEMPORARY_CHAT_QUERY_ID] === true
    ) {
      result['temporary-chat'] = true
    }

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    return result
  },
})

function Index() {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const search = useSearch({ from: route.home as any })
  const selectedModel = search.model
<<<<<<< HEAD
  const isTemporaryChat = search['temporary-chat']
  const { setCurrentThreadId } = useThreads()
  const isMobile = useMobileScreen()
=======
  const { setCurrentThreadId } = useThreads()
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  useTools()

  // Conditional to check if there are any valid providers
  // required min 1 api_key or 1 model in llama.cpp or jan provider
  // Custom providers (not in predefinedProviders) don't require api_key but need models
  const hasValidProviders = providers.some((provider) => {
    const isPredefinedProvider = predefinedProviders.some(
      (p) => p.provider === provider.provider
    )

    // Custom providers don't need API key validation but must have models
    if (!isPredefinedProvider) {
      return provider.models.length > 0
    }

    // Predefined providers need either API key or models (for llamacpp/jan)
    return (
      provider.api_key?.length ||
      (provider.provider === 'llamacpp' && provider.models.length) ||
      (provider.provider === 'jan' && provider.models.length)
    )
  })

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  if (!hasValidProviders) {
    return <SetupScreen />
  }

  return (
<<<<<<< HEAD
    <div className="flex h-full flex-col justify-center pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
            <DropdownAssistant />
          )}
=======
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <DropdownModelProvider />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        </div>
      </HeaderPage>
      <div
        className={cn(
<<<<<<< HEAD
          'h-full overflow-y-auto inline-flex flex-col gap-2 justify-center px-3 sm:px-4 md:px-8 py-4 md:py-0'
=======
          'h-full overflow-y-auto inline-flex flex-col gap-2 justify-center px-3'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        )}
      >
        <div
          className={cn(
<<<<<<< HEAD
            'mx-auto',
            // Full width on mobile, constrained on desktop
            isMobile ? 'w-full max-w-full' : 'w-full md:w-4/6'
          )}
        >
          <div
            className={cn(
              'text-center',
              // Adjust spacing for mobile
              isMobile ? 'mb-6' : 'mb-8'
            )}
          >
            <h1
              className={cn(
                'font-editorialnew text-main-view-fg',
                // Responsive title size
                isMobile ? 'text-2xl sm:text-3xl' : 'text-4xl'
              )}
            >
              {isTemporaryChat ? t('chat:temporaryChat') : t('chat:welcome')}
            </h1>
            <p
              className={cn(
                'text-main-view-fg/70 mt-2',
                // Responsive description size
                isMobile ? 'text-base' : 'text-lg'
              )}
            >
              {isTemporaryChat
                ? t('chat:temporaryChatDescription')
                : t('chat:description')}
            </p>
=======
            'mx-auto w-full md:w-4/5 xl:w-4/6 -mt-20',
          )}
        >
          <div className={cn('text-center mb-4')}>
            <h1
              className={cn(
                'text-2xl mt-2 font-studio font-medium',
              )}
            >
              {t('chat:description')}
            </h1>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
