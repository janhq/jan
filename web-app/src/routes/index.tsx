/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
import { toast } from 'sonner'
import { CoworkComposerMenu } from '@/containers/CoworkComposerMenu'
import { HomeWorkspacePicker } from '@/containers/HomeWorkspacePicker'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import type { ThreadFolder } from '@/services/projects/types'
import { HomeModeToggle } from '@/containers/HomeModeToggle'
import { useHomeMode } from '@/hooks/useHomeMode'
import { useServiceHub } from '@/hooks/useServiceHub'
import { usePrompt } from '@/hooks/usePrompt'
import { startCoworkConversation } from '@/lib/startCoworkConversation'
import { isCoworkEnabled } from '@/lib/version'
import { basenameOf } from '@/lib/coworkPreview'
import { COWORK_IDEAS } from '@/lib/coworkIdeas'
import { Code2, FileText, Folder, LayoutDashboard, X } from 'lucide-react'
import type { Attachment } from '@/types/attachment'
import { useThreads } from '@/hooks/useThreads'

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
  const reduceMotion = useReducedMotion()
  const { providers, selectedModel, selectedProvider } = useModelProvider()
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
  const [project, setProject] = useState<ThreadFolder | null>(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const { addFolder, folders: projects } = useThreadManagement()
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
      let id: string
      try {
        id = startCoworkConversation({
          model: selectedModel
            ? { id: selectedModel.id, provider: selectedProvider }
            : threadModel,
          folder,
          project: project ?? undefined,
          handoff: { text, draft, files, documents },
        })
      } catch (e) {
        console.warn('[cowork] could not store the first prompt:', e)
        toast.error(t('common:error'))
        return false
      }
      setFolder(null)
      setProject(null)
      navigate({ to: route.coworkSession, params: { sessionId: id } })
    },
    [folder, project, threadModel, selectedModel, selectedProvider, navigate, t]
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
      <AddProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        editingKey={null}
        onSave={async (name, assistantId) => {
          const created = await addFolder(name, assistantId)
          setProject(created)
          setProjectDialogOpen(false)
        }}
      />
      <HeaderPage />
      <div
        className={cn(
          'h-full overflow-y-auto inline-flex flex-col gap-2 justify-center px-3'
        )}
      >
        <motion.div
          layout="position"
          transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full px-6 md:w-4/5 xl:w-4/6 -mt-20"
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
              projectId={mode === 'chat' ? project?.id : undefined}
              projectAssistantId={mode === 'chat' ? project?.assistantId : undefined}
              onSubmit={mode === 'cowork' ? startCowork : undefined}
              scopeKey={mode === 'cowork' ? 'home-cowork' : undefined}
              supportsAssistants={mode === 'chat'}
              ownsToolSet={mode === 'cowork' ? false : undefined}
              menuWorkspace={(
                <CoworkComposerMenu
                  section="workspace"
                  projects={projects}
                  projectId={project?.id}
                  onAttachFolder={mode === 'cowork' ? () => void pickFolder() : undefined}
                  onSelectProject={setProject}
                  onAddProject={() => setProjectDialogOpen(true)}
                />
              )}
              leadingControls={
                coworkAvailable ? (
                  <HomeModeToggle mode={mode} onChange={setMode} />
                ) : undefined
              }
            />
          </div>
          {mode === 'chat' && project && (
            <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground" data-testid="home-chat-project">
              <Folder className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{project.name}</span>
              <button
                type="button"
                className="rounded-sm p-1 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('common:homeMode.removeFolder')}
                onClick={() => setProject(null)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
          <AnimatePresence initial={false}>
            {mode === 'cowork' && (
              <motion.div
                key="cowork-workspace"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="-mx-3 overflow-hidden px-3"
              >
                <div className="pt-2">
                  <HomeWorkspacePicker
                    folder={folder}
                    project={project}
                    projects={projects}
                    onSelectProject={setProject}
                    onAddFolder={() => void pickFolder()}
                    onAddProject={() => setProjectDialogOpen(true)}
                    onRemove={() => { setFolder(null); setProject(null) }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false}>
          {mode === 'cowork' && (
            <motion.div
              key="cowork-options"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="-mx-3 overflow-hidden px-3"
            >
            <div className="pt-4 pb-2">
              <div className="w-full">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('common:homeMode.ideas')}</h2>
                <div className="mt-3 -mx-3 flex flex-col gap-1">
                  {COWORK_IDEAS.map((key) => {
                    const Icon = key === 'first' ? Code2 : key === 'second' ? LayoutDashboard : FileText
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
                        className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-base leading-6 text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                      >
                        <Icon aria-hidden="true" strokeWidth={1.6} className="mt-0.5 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                        <span className="min-w-0 break-words">{text}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}
