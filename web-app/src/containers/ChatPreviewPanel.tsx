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
  previewKindFor,
  type PreviewState,
} from '@/lib/coworkPreview'

/**
 * Raster formats native `read` cannot encode as an image (bmp, ico). Reading
 * them would return raw bytes that fail as a UTF-8 error, so they are
 * unsupported up front: no host read, no misleading failure.
 */
const UNSUPPORTED_RASTER = /\.(?:bmp|ico)$/i

/**
 * The only image URL Chat renders: an inline raster the host itself encoded
 * (native `read` emits png, jpeg, gif and webp). Never SVG, never a network or
 * asset URL, so a malicious `https:` or `asset:` string in a result is refused.
 */
const HOST_IMAGE_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

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
 * HTML and SVG appear as source text, never as a live document.
 */
export function ChatPreviewPanel({ threadId, path, onClose }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const [nonce, setNonce] = useState(0)
  const kind = previewKindFor(path)

  useEffect(() => {
    let alive = true
    if (
      kind === 'file' ||
      kind === 'video' ||
      kind === 'audio' ||
      (kind === 'image' && UNSUPPORTED_RASTER.test(path))
    ) {
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
        if (kind === 'image' && res.error.includes('not a UTF-8 text file')) {
          setState({ status: 'unsupported', path })
          return
        }
        setState({ status: 'failed', path, reason: res.error })
        return
      }
      if (kind === 'image') {
        const url = res.images?.[0]?.dataUrl
        setState(
          typeof url === 'string' && HOST_IMAGE_URL.test(url)
            ? { status: 'ready', path, kind, assetUrl: url }
            : { status: 'unsupported', path }
        )
        return
      }
      const content = typeof res.content === 'string' ? res.content : ''
      // HTML and SVG are shown as source text, never rendered, so a truncated
      // source is still safe and honest to show as text. Chat runs no artifact
      // script and follows no meta refresh, and nothing here proves the frame's
      // network and navigation confinement. Cowork keeps its own sandboxed
      // renderer.
      setState({
        status: 'ready',
        path,
        kind: kind === 'html' || kind === 'svg' ? 'text' : kind,
        content,
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
