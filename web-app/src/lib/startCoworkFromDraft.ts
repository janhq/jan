import { toast } from 'sonner'
import { i18n } from '@/i18n/react-i18next-compat'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useModelProvider } from '@/hooks/useModelProvider'
import { coworkAllowsProvider } from '@/lib/coworkModelControls'
import { writeCoworkHandoff } from '@/lib/coworkHandoff'
import { route } from '@/constants/routes'
import type { Attachment } from '@/types/attachment'
import type { ThreadFolder } from '@/services/projects/types'

/** What the composer hands over when the home draft carries a folder. */
export type FolderDraftSubmission = {
  /** The prompt with @path references expanded. */
  text: string
  /** What the user typed, so a refused run can hand it back unchanged. */
  draft: string
  files?: Array<{ type: 'file'; mediaType: string; url: string }>
  documents?: Attachment[]
}

/**
 * - `started`: a Cowork conversation was created and opened; the first prompt
 *   travels to it through the handoff.
 * - `refused`: nothing was created; the draft stays in the composer.
 * - `chat`: not a folder conversation, send it as an ordinary chat.
 */
export type FolderDraftOutcome = 'started' | 'refused' | 'chat'

type Navigate = (options: {
  to: string
  params: { sessionId: string }
}) => unknown

/**
 * The interim folder bridge. The Chat executor cannot use a folder yet, so a
 * home draft that carries one starts a `mode: 'cowork'` conversation, run by the
 * Cowork runner on its first prompt. This is the only place a new Cowork
 * conversation is created, and it is explicit: no folder, no Cowork.
 *
 * It refuses up front what the runner would refuse after navigating (no model,
 * no tool support, a provider Cowork cannot use), so the user keeps the draft
 * and the folder instead of landing on an empty page.
 */
export function startCoworkFromDraft(args: {
  folder: string
  project?: ThreadFolder | null
  submission: FolderDraftSubmission
  navigate: Navigate
}): FolderDraftOutcome {
  const { folder, project, submission, navigate } = args
  const t = i18n.t.bind(i18n)
  const { providers, selectedProvider, selectedModel } =
    useModelProvider.getState()
  if (!selectedModel?.id) {
    toast.error(t('common:selectModel'))
    return 'refused'
  }
  const provider = providers.find(
    (p) => p.provider === selectedProvider && p.active
  )
  if (!coworkAllowsProvider(provider)) {
    toast.error(t('common:coworkExtensionProvider'))
    return 'refused'
  }
  if (!selectedModel.capabilities?.includes('tools')) {
    toast.error(t('common:modelNoTools', { model: selectedModel.id }))
    return 'refused'
  }

  const store = useCoworkSessions.getState()
  const sessionId = store.createSession()
  // createSession reuses an untouched current session, so set every field the
  // draft decides rather than assume a blank one.
  store.setFolder(sessionId, folder)
  store.setModel(sessionId, { provider: selectedProvider, id: selectedModel.id })
  store.setPlanMode(sessionId, false)
  store.setProject(
    sessionId,
    project
      ? {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
          assistantId: project.assistantId,
        }
      : undefined
  )
  try {
    writeCoworkHandoff(sessionId, submission)
  } catch (error) {
    console.warn('[cowork] could not hand the first prompt over:', error)
    toast.error(t('common:homeMode.startFailed'))
    return 'refused'
  }
  void navigate({ to: route.coworkSession, params: { sessionId } })
  return 'started'
}
