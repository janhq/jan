/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
import { hasUsableProvider } from '@/lib/providerReadiness'

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}
import { useCallback, useEffect, useState } from 'react'
import { FolderPlus, Folder, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HomeModeToggle } from '@/containers/HomeModeToggle'
import { useHomeMode } from '@/hooks/useHomeMode'
import { useCoworkSessions, startNewSession } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { useServiceHub } from '@/hooks/useServiceHub'
import { usePrompt } from '@/hooks/usePrompt'
import { writeCoworkHandoff } from '@/lib/coworkHandoff'
import { isCoworkEnabled } from '@/lib/version'
import { basenameOf } from '@/lib/coworkPreview'
import { COWORK_IDEAS } from '@/lib/coworkIdeas'
import type { Attachment } from '@/types/attachment'
import { useThreads } from '@/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'

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
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const coworkAvailable = isCoworkEnabled()
  const storedMode = useHomeMode((s) => s.mode)
  const setMode = useHomeMode((s) => s.setMode)
  // The selector is hidden where Cowork is not available; the mode is then Chat
  // whatever was stored.
  const mode = coworkAvailable ? storedMode : 'chat'
  const [folder, setFolder] = useState<string | null>(null)
  useTools()

  const pickFolder = useCallback(async () => {
    const picked = await serviceHub.dialog().open({ directory: true })
    if (typeof picked === 'string') setFolder(picked)
  }, [serviceHub])

  // Starting a Cowork conversation: create the session, hand the first prompt
  // to it by session id, and open its own URL. The Cowork view runs it.
  const startCowork = useCallback(
    (
      text: string,
      files?: Array<{ type: 'file'; mediaType: string; url: string }>,
      documents?: Attachment[],
      draft?: string
    ) => {
      const runningIds = Object.keys(useCoworkRun.getState().runId)
      const id = startNewSession(runningIds)
      if (folder) useCoworkSessions.getState().setFolder(id, folder)
      try {
        writeCoworkHandoff(id, { text, draft, files, documents })
      } catch (e) {
        console.warn('[cowork] could not store the first prompt:', e)
        toast.error(t('common:error'))
        return
      }
      setFolder(null)
      navigate({ to: route.coworkSession, params: { sessionId: id } })
    },
    [folder, navigate, t]
  )

  const hasValidProviders = hasUsableProvider(providers)

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  if (!hasValidProviders) {
    return <SetupScreen />
  }

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <DropdownModelProvider model={threadModel} />
        </div>
      </HeaderPage>
      <div
        className={cn(
          'h-full overflow-y-auto inline-flex flex-col gap-2 justify-center px-3'
        )}
      >
        <div
          className={cn(
            'mx-auto w-full px-6 md:w-4/5 xl:w-4/6 -mt-20',
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
          </div>
          <div className="flex-1 shrink-0">
            <ChatInput
              showSpeedToken={false}
              model={threadModel}
              initialMessage={true}
              onSubmit={mode === 'cowork' ? startCowork : undefined}
              scopeKey={mode === 'cowork' ? 'home-cowork' : undefined}
              ownsToolSet={mode === 'cowork' ? false : undefined}
              surfaceControls={
                coworkAvailable ? (
                  <HomeModeToggle mode={mode} onChange={setMode} />
                ) : undefined
              }
            />
          </div>
          {mode === 'cowork' && (
            <div className="mt-3 flex flex-col items-start gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  data-testid="home-cowork-folder"
                  onClick={() => void pickFolder()}
                >
                  {folder ? <Folder className="size-4" /> : <FolderPlus className="size-4" />}
                  {folder ? basenameOf(folder) : t('common:homeMode.addFolder')}
                </Button>
                {folder && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full"
                    aria-label={t('common:homeMode.removeFolder')}
                    onClick={() => setFolder(null)}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
              <div className="w-full">
                <p className="text-sm font-medium">{t('common:homeMode.ideas')}</p>
                <div className="mt-1 -mx-2 flex flex-col items-start">
                  {COWORK_IDEAS.map((key) => {
                    const name = folder ? basenameOf(folder) : null
                    const text = t(
                      `common:coworkEmpty.${folder ? 'folder' : 'sandbox'}.${key}`,
                      { folder: name }
                    )
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => usePrompt.getState().setPrompt(text)}
                        className="max-w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {text}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
