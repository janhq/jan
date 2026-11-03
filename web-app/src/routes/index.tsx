/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useLocation, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import { motion, useReducedMotion } from 'motion/react'
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
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useHomeScope } from '@/hooks/useHomeScope'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Folder, ShieldCheck, X } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ConversationCapabilitiesConsent } from '@/containers/ConversationCapabilitiesConsent'
import {
  defaultConversationCapabilities,
  isConversationFolderPath,
  type ConversationCapabilitiesV1,
} from '@/lib/conversationCapabilities'
import { isTemporaryChatSearch } from '@/constants/chat'
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
  const { providers, selectedModel } = useModelProvider()
  const search = useSearch({ from: route.home as any })
  const threadModel = search.threadModel
  const { setCurrentThreadId } = useThreads()
  const serviceHub = useServiceHub()
  // Single home flow: every NEW conversation is an ordinary Chat thread. There
  // is no mode selector and no hidden classifier choosing a privileged path:
  // elevated capability is only ever the explicit consent draft below, applied
  // through prepareThreadCreation's narrow grant. Existing Cowork sessions keep
  // their own routes (/cowork, /cowork/$sessionId) and sidebar entries; the
  // home composer never creates a new legacy Session.
  const { project, setProject } = useHomeScope()
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const { addFolder, folders: projects } = useThreadManagement()
  useTools()

  // Draft consent for the NEXT persistent chat. It authorizes nothing by
  // itself: ChatInput snapshots it through prepareThreadCreation and it is
  // persisted only through the strict setter after the thread exists. The
  // draft never carries over to another conversation (route state).
  const [scopeDraft, setScopeDraft] = useState<ConversationCapabilitiesV1>(
    defaultConversationCapabilities
  )
  const scopeDraftElevated =
    scopeDraft.shellNetwork ||
    scopeDraft.memoryWrite ||
    scopeDraft.folderScope !== null
  // Same temporary-mode flag ChatInput's send path reads, but taken from the
  // router-subscribed raw search string: this route's validateSearch keeps
  // only threadModel, so the VALIDATED search can stay structurally equal
  // when the flag toggles — searchStr is a plain string the router always
  // updates, so the subscription re-renders deterministically. A temporary
  // chat gets no consent control, not even a draft: the pending draft is
  // preserved but the prepare path is removed, so ordinary temporary scratch
  // sends are unchanged.
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const isTemporaryChat = isTemporaryChatSearch(searchStr)
  const modelSupportsTools =
    selectedModel?.capabilities?.includes('tools') ?? false
  const chatScopeAvailable = !isTemporaryChat && modelSupportsTools
  // Truthful unsupported reason: the capability control disappears only with
  // an explanation. Ordinary direct chat is never refused — a model without
  // tool support still answers one-call questions through the same composer.
  const scopeUnsupportedReason =
    !isTemporaryChat && selectedModel && !modelSupportsTools
      ? t('common:conversationScope.unsupported') + (scopeDraftElevated ? ` ${t('common:conversationScope.pendingKept')}` : '')
      : null
  const pickScopeFolder = useCallback(async () => {
    const picked = await serviceHub.dialog().open({ directory: true })
    return typeof picked === 'string' ? picked : null
  }, [serviceHub])
  // The workspace menu's folder action feeds the SAME consent draft (read-only
  // narrow grant) instead of a legacy Session folder. Unsupported states get a
  // truthful reason; unsupported paths are denied with the consent wording.
  const attachScopeFolder = useCallback(async () => {
    if (isTemporaryChat) {
      toast.info(t('common:conversationScope.temporary'))
      return
    }
    if (!selectedModel) {
      toast.info(t('common:conversationScope.folderSelectModel'))
      return
    }
    if (!modelSupportsTools) {
      toast.info(
        t('common:conversationScope.folderUnsupported')
      )
      return
    }
    const picked = await pickScopeFolder()
    if (picked === null) return
    if (!isConversationFolderPath(picked)) {
      toast.error(t('common:conversationScope.invalidFolder'))
      return
    }
    // Functional write: the draft is read at commit time, never from a closure
    // captured before the picker opened. The note describes only the selected
    // path (always read-only) and makes no claim about what it replaced.
    setScopeDraft((draft) => ({
      ...draft,
      folderScope: { path: picked, access: 'read' },
    }))
    toast.info(t('common:conversationScope.folderSelected', { path: picked }))
  }, [isTemporaryChat, selectedModel, modelSupportsTools, pickScopeFolder, t])
  const prepareThreadCreation = useCallback(() => {
    const snapshot = scopeDraft
    return async (threadId: string) => {
      await useThreads.getState().setConversationCapabilities(threadId, snapshot)
      return true
    }
  }, [scopeDraft])

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
              projectId={project?.id}
              projectAssistantId={project?.assistantId}
              supportsAssistants={true}
              menuWorkspace={(
                <CoworkComposerMenu
                  section="workspace"
                  projects={projects}
                  projectId={project?.id}
                  onAttachFolder={() => void attachScopeFolder()}
                  onSelectProject={setProject}
                  onAddProject={() => setProjectDialogOpen(true)}
                />
              )}
              prepareThreadCreation={
                chatScopeAvailable && scopeDraftElevated
                  ? prepareThreadCreation
                  : undefined
              }
            />
          </div>
          {chatScopeAvailable && (
            <div className="pt-2" data-testid="home-scope-consent">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-sm p-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="home-scope-consent-trigger"
                  >
                    <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                    <span>
                      Conversation permissions
                      {scopeDraftElevated ? ' (pending)' : ''}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <ConversationCapabilitiesConsent
                    value={scopeDraft}
                    onChange={setScopeDraft}
                    onPickFolder={pickScopeFolder}
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
          {/* Persistent live region: stays mounted so screen readers announce
              text that appears or changes inside it. The inner <p> carries no
              live attributes of its own. */}
          <div role="status" aria-live="polite" data-testid="home-scope-status">
            {scopeUnsupportedReason && (
              <p
                className="pt-2 text-xs leading-5 text-muted-foreground"
                data-testid="home-scope-unsupported"
              >
                {scopeUnsupportedReason}
              </p>
            )}
          </div>
          {project && (
            <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground" data-testid="home-chat-project">
              <Folder className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{project.name}</span>
              <button
                type="button"
                className="rounded-sm p-1 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('common:conversationScope.removeProject')}
                onClick={() => setProject(null)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
