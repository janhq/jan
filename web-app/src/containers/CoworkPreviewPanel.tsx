import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, Globe, RotateCw, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { CoworkSidePanel } from '@/containers/CoworkSidePanel'
import { getServiceHub, useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { buildSrcDoc } from '@/lib/htmlSandbox'
import { cn } from '@/lib/utils'
import {
  MAX_PREVIEW_BYTES,
  basenameOf,
  isAssetKind,
  previewKindFor,
  resolveInRoot,
  unresolvedRefs,
  type PreviewState,
} from '@/lib/coworkPreview'

/** Held as a key, not a translated string: the loader must not depend on `t`,
 * whose identity changes on every render. */
const TOO_LARGE = 'common:preview.tooLarge'

type Props = {
  /** The session sandbox. Every previewed path must resolve inside it. */
  root: string | null
  path: string
  onClose: () => void
}

/**
 * Renders one artifact beside the transcript.
 *
 * Files are read straight off disk through the asset protocol rather than the
 * agent's `read` tool: that tool caps its output and appends a truncation
 * footer, which is right for a model and wrong for a preview, and it hands back
 * a description of an image rather than its bytes.
 */
export function CoworkPreviewPanel({ root, path, onClose }: Props) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  // Bumped by Reload. Content is never swapped underneath the user: they may be
  // mid-interaction in a document or a running page.
  const [nonce, setNonce] = useState(0)
  const [allowNetwork, setAllowNetwork] = useState(false)

  const abs = useMemo(
    () => (root ? resolveInRoot(root, path) : null),
    [root, path]
  )
  const kind = useMemo(() => previewKindFor(path), [path])

  useEffect(() => {
    let alive = true
    if (!abs) {
      setState({ status: 'failed', path, reason: 'common:preview.outside' })
      return
    }
    if (kind === 'file') {
      setState({ status: 'unsupported', path })
      return
    }
    setState({ status: 'loading', path })

    void (async () => {
      const url = getServiceHub().core().convertFileSrc(abs)
      if (isAssetKind(kind)) {
        // The element streams the file itself, so there is nothing to fetch and
        // a large video costs nothing to "open".
        if (alive) setState({ status: 'ready', path, kind, assetUrl: url })
        return
      }
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        const size = Number(res.headers.get('content-length') ?? 0)
        if (size > MAX_PREVIEW_BYTES) throw new Error(TOO_LARGE)
        const content = await res.text()
        if (content.length > MAX_PREVIEW_BYTES) throw new Error(TOO_LARGE)
        if (!alive) return
        setState({
          status: 'ready',
          path,
          kind,
          content,
          unresolvedRefs: kind === 'html' ? unresolvedRefs(content) : undefined,
        })
      } catch (e) {
        if (!alive) return
        setState({
          status: 'failed',
          path,
          reason: e instanceof Error ? e.message : String(e),
        })
      }
    })()

    return () => {
      alive = false
    }
  }, [abs, path, kind, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const iconButton = (
    label: string,
    Icon: typeof RotateCw,
    onClick: () => void,
    active?: boolean
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'shrink-0',
            active ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <CoworkSidePanel
      title={basenameOf(path)}
      onClose={onClose}
      summary={
        <div className="flex shrink-0 items-center gap-0.5">
          {state.status === 'ready' && state.kind === 'html' &&
            iconButton(
              t('common:preview.allowNetwork'),
              Globe,
              () => setAllowNetwork((v) => !v),
              allowNetwork
            )}
          {iconButton(t('common:preview.reload'), RotateCw, reload)}
          {abs && (
            <>
              {iconButton(
                t('common:artifactOpenExternal'),
                SquareArrowOutUpRight,
                () => void serviceHub.opener().openPath(abs)
              )}
              {iconButton(
                t('common:artifactShowInFolder'),
                FolderOpen,
                () => void serviceHub.opener().revealItemInDir(abs)
              )}
            </>
          )}
        </div>
      }
    >
      <PreviewBody state={state} allowNetwork={allowNetwork} />
    </CoworkSidePanel>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function PreviewBody({
  state,
  allowNetwork,
}: {
  state: PreviewState
  allowNetwork: boolean
}) {
  const { t } = useTranslation()

  if (state.status === 'idle' || state.status === 'loading') {
    return <Notice>{t('common:preview.loading')}</Notice>
  }
  if (state.status === 'unsupported') {
    return <Notice>{t('common:preview.unsupported')}</Notice>
  }
  if (state.status === 'failed') {
    // Our own reasons are keys; anything from `fetch` is already a message.
    return (
      <Notice>
        {state.reason.startsWith('common:') ? t(state.reason) : state.reason}
      </Notice>
    )
  }

  switch (state.kind) {
    case 'html':
    case 'svg': {
      // SVG is static markup, so it runs no scripts; HTML gets them, because an
      // artifact that draws a chart is inert without them.
      const scripts = state.kind === 'html'
      return (
        <div className="flex h-full flex-col">
          {(state.unresolvedRefs ?? 0) > 0 && (
            <p className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('common:preview.unresolvedRefs', {
                count: state.unresolvedRefs,
              })}
            </p>
          )}
          <iframe
            title={state.path}
            srcDoc={buildSrcDoc(state.content ?? '', allowNetwork, scripts)}
            sandbox={scripts ? 'allow-scripts' : ''}
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        </div>
      )
    }
    case 'markdown':
      return (
        <div className="h-full overflow-auto px-4 py-3">
          <RenderMarkdown content={state.content ?? ''} />
        </div>
      )
    case 'text':
      return (
        <pre className="h-full overflow-auto p-3 font-mono text-xs leading-relaxed">
          {state.content}
        </pre>
      )
    case 'image':
      return (
        <div className="flex h-full items-center justify-center overflow-auto p-3">
          <img
            src={state.assetUrl}
            alt={basenameOf(state.path)}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )
    case 'video':
      return (
        <div className="flex h-full items-center justify-center p-3">
          <video src={state.assetUrl} controls className="max-h-full w-full" />
        </div>
      )
    case 'audio':
      return (
        <div className="flex h-full items-center justify-center p-3">
          <audio src={state.assetUrl} controls className="w-full" />
        </div>
      )
  }
}
