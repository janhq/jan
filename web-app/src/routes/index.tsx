/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { usePrompts } from '@/hooks/usePrompts'
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
import { useEffect, useState } from 'react'
import { useThreads } from '@/hooks/useThreads'
import { CoworkComposerMenu } from '@/containers/CoworkComposerMenu'
import { DraftWorkspacePill } from '@/containers/DraftWorkspacePill'
import { DraftProjectChip } from '@/containers/DraftProjectChip'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useHomeScope } from '@/hooks/useHomeScope'
import { useFolderDraft } from '@/hooks/useFolderDraft'

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
  usePrompts()

  // One home flow: every new conversation is an ordinary chat. Attaching a
  // folder only gives that chat the folder (see useFolderDraft). No mode
  // selector, no hidden classifier. The project is route-local intent so it
  // never leaks into the next draft.
  const { project, setProject } = useHomeScope()
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const { addFolder, folders: projects } = useThreadManagement()
  const workspace = useFolderDraft()

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
              projectId={project?.id}
              projectAssistantId={project?.assistantId}
              menuWorkspace={
                <CoworkComposerMenu
                  projects={projects}
                  projectId={project?.id}
                  onAttachFolder={workspace.available ? workspace.attach : undefined}
                  onSelectProject={setProject}
                  onAddProject={() => setProjectDialogOpen(true)}
                />
              }
              draftFolder={workspace.folder}
              onDraftFolderUsed={workspace.detach}
            />
          </div>
          <DraftWorkspacePill
            folder={workspace.folder}
            onPickFolder={workspace.attach}
            onDetach={workspace.detach}
          />
          {project && (
            <DraftProjectChip
              project={project}
              onRemove={() => setProject(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
