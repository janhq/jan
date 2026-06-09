/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import { route } from '@/constants/routes'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import { WorkspacePanelsLayout } from '@/containers/ModelToolsPanel'
import { Button } from '@/components/ui/button'

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}
import { useEffect } from 'react'
import { useThreads } from '@/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute(route.home as any)({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const result: SearchParams = {
      threadModel: search.threadModel as ThreadModel | undefined,
    }

    return result
  },
})

function Index() {
  const { t } = useTranslation()
  const { providers } = useModelProvider()
  const search = useSearch({ from: route.home as any })
  const threadModel = search.threadModel
  const { setCurrentThreadId } = useThreads()
  useTools()

  // Non-blocking model setup check so the app can boot without downloads.
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
      providerHasRemoteApiKeys(provider) ||
      (provider.provider === 'llamacpp' && provider.models.length) ||
      (provider.provider === 'jan' && provider.models.length)
    )
  })

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  return (
    <WorkspacePanelsLayout
      scope={{ id: 'home', type: 'workspace', label: 'Home' }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <HeaderPage>
          <div className="flex w-full items-center pr-3">
            <div className="min-w-0 max-w-[22rem]">
              <DropdownModelProvider model={threadModel} />
            </div>
          </div>
        </HeaderPage>
        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              'min-w-0 flex-1 overflow-y-auto inline-flex flex-col gap-2 justify-center px-3'
            )}
          >
            <div className={cn('mx-auto w-full md:w-4/5 xl:w-4/6 -mt-20')}>
              <div className={cn('text-center mb-4')}>
                <h1 className={cn('text-2xl mt-2 font-studio font-medium')}>
                  {t('chat:description')}
                </h1>
              </div>
              {!hasValidProviders && (
                <div className="mb-4 rounded-md border border-dashed border-foreground/15 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    No model provider is set up yet.
                  </p>
                  <p>
                    Add OpenAI, Jan, Ollama, vLLM, Grok, or another provider
                    from Model Providers to start chatting with your local or
                    remote model.
                  </p>
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                  >
                    <Link to={route.settings.model_providers}>
                      Open Model Providers
                    </Link>
                  </Button>
                </div>
              )}
              <div className="flex-1 shrink-0">
                <ChatInput
                  showSpeedToken={false}
                  model={threadModel}
                  initialMessage={true}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspacePanelsLayout>
  )
}
