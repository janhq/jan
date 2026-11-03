import { useCallback, useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CoworkPanelButton, CoworkSidePanel } from '@/containers/CoworkSidePanel'
import { PreviewBody } from '@/containers/CoworkPreviewPanel'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { executeAgentTool } from '@/lib/agentTools'
import { useThreads } from '@/hooks/useThreads'
import {
  basenameOf,
  externalRefs,
  previewKindFor,
  unresolvedRefs,
  type PreviewState,
} from '@/lib/coworkPreview'

/** What native `read` appends when it capped the output. */
const TRUNCATED = '\n[truncated:'

type Props = {
  threadId: string
  /** A display candidate only. The host decides whether it may be read. */
  path: string
  onClose: () => void
}

/**
 * Chat's artifact preview. Unlike Cowork's pane it never touches the disk from
 * the webview: no asset-protocol URL, no `preview://` root, no open/reveal. The
 * only data path is the host's thread-scoped `read`, which derives the thread's
 * roots from stored + confirmed + effective consent and canonicalizes every
 * path, symlinks included. Roots the UI believes in carry no authority.
 *
 * Media that needs the asset protocol (video, audio) is not previewed here.
 */
export function ChatPreviewPanel({ threadId, path, onClose }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const [nonce, setNonce] = useState(0)
  const kind = previewKindFor(path)

  useEffect(() => {
    let alive = true
    if (kind === 'file' || kind === 'video' || kind === 'audio') {
      setState({ status: 'unsupported', path })
      return
    }
    setState({ status: 'loading', path })
    void (async () => {
      // Fresh per read, never captured: a revoke between two reads must narrow
      // the second. Passed as the ceiling so the call can never run on the
      // default grant when the host's stored consent is wider than the overlay.
      const grant = useThreads.getState().getConversationCapabilities(threadId)
      const res = await executeAgentTool(
        'read',
        { path },
        threadId,
        null,
        'thread',
        false,
        false,
        null,
        grant
      )
      if (!alive) return
      if (res.error !== undefined) {
        setState({ status: 'failed', path, reason: res.error })
        return
      }
      if (kind === 'image') {
        const url = res.images?.[0]?.dataUrl
        setState(
          url
            ? { status: 'ready', path, kind, assetUrl: url }
            : { status: 'unsupported', path }
        )
        return
      }
      const content = typeof res.content === 'string' ? res.content : ''
      // A cut-off page or vector would render wrongly; cut-off text is fine.
      if ((kind === 'html' || kind === 'svg') && content.includes(TRUNCATED)) {
        setState({ status: 'failed', path, reason: 'common:preview.tooLarge' })
        return
      }
      setState({
        status: 'ready',
        path,
        kind,
        content,
        unresolvedRefs: kind === 'html' ? unresolvedRefs(content) : undefined,
        externalRefs: kind === 'html' ? externalRefs(content) : undefined,
      })
    })().catch((e: unknown) => {
      // A rejected read (revoke race, host failure) must be a visible failure,
      // never a preview stuck on "loading".
      if (!alive) return
      setState({
        status: 'failed',
        path,
        reason: e instanceof Error ? e.message : String(e),
      })
    })
    return () => {
      alive = false
    }
  }, [threadId, path, kind, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return (
    <CoworkSidePanel
      title={basenameOf(path)}
      onClose={onClose}
      summary={
        <Tooltip>
          <TooltipTrigger asChild>
            <CoworkPanelButton onClick={reload} aria-label={t('common:preview.reload')}>
              <RotateCw className="size-4" />
            </CoworkPanelButton>
          </TooltipTrigger>
          <TooltipContent>{t('common:preview.reload')}</TooltipContent>
        </Tooltip>
      }
    >
      <PreviewBody state={state} allowNetwork={false} liveUrl={null} />
    </CoworkSidePanel>
  )
}
