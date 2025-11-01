import { createFileRoute, useParams } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'

import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'
import DropdownAssistant from '@/containers/DropdownAssistant'

import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform/types'
import { IconMessage } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useSmallScreen } from '@/hooks/useMediaQuery'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectPage,
})

function ProjectPage() {
  return (
    <PlatformGuard feature={PlatformFeature.PROJECTS}>
      <ProjectPageContent />
    </PlatformGuard>
  )
}

function ProjectPageContent() {
  const { t } = useTranslation()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const { getFolderById } = useThreadManagement()
  const threads = useThreads((state) => state.threads)

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()

  // Find the project
  const project = getFolderById(projectId)

  // Get threads for this project
  const projectThreads = useMemo(() => {
    return Object.values(threads)
      .filter((thread) => thread.metadata?.project?.id === projectId)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }, [threads, projectId])

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-main-view-fg mb-2">
            {t('projects.projectNotFound')}
          </h1>
          <p className="text-main-view-fg/70">
            {t('projects.projectNotFoundDesc')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <HeaderPage>
        <div className="flex items-center justify-between w-full">
          {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
            <DropdownAssistant />
          )}
        </div>
      </HeaderPage>

      <div className="h-full relative flex flex-col justify-between px-4 md:px-8 py-4 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex h-full flex-col justify-between',
            chatWidth === 'compact' ? 'w-full md:w-4/6' : 'w-full',
            isSmallScreen && 'w-full'
          )}
        >
          <div className="flex h-full flex-col">
            <div className="mb-6 mt-2">
              {projectThreads.length > 0 && (
                <>
                  <h2 className="text-xl font-semibold text-main-view-fg mb-2">
                    {t('projects.conversationsIn', {
                      projectName: project.name,
                    })}
                  </h2>
                  <p className="text-main-view-fg/70">
                    {t('projects.conversationsDescription')}
                  </p>
                </>
              )}
            </div>

            {/* Thread List or Empty State */}
            <div className="mb-0">
              {projectThreads.length > 0 ? (
                <ThreadList
                  threads={projectThreads}
                  variant="project"
                  currentProjectId={projectId}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <IconMessage
                    size={48}
                    className="text-main-view-fg/30 mb-4"
                  />
                  <h3 className="text-lg font-medium text-main-view-fg/60 mb-2">
                    {t('projects.noConversationsIn', {
                      projectName: project.name,
                    })}
                  </h3>
                  <p className="text-main-view-fg/50 text-sm">
                    {t('projects.startNewConversation', {
                      projectName: project.name,
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* New Chat Input */}
      <div
        className={cn(
          'mx-auto pt-2 pb-3 shrink-0 relative px-2',
          chatWidth === 'compact' ? 'w-full md:w-4/6' : 'w-full',
          isSmallScreen && 'w-full'
        )}
      >
        <ChatInput
          showSpeedToken={false}
          initialMessage={true}
          projectId={projectId}
        />
      </div>
    </div>
  )
}
