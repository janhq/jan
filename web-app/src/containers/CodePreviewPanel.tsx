import { useCallback, useEffect, useState } from 'react'
import { fs } from '@janhq/core'
import { AlertTriangle, FileIcon, FolderOpen, Pencil, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { CodeSidePanel } from '@/containers/CodeSidePanel'
import { HtmlArtifact } from '@/components/HtmlArtifact'
import { AnnotationOverlay } from '@/components/AnnotationOverlay'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useCodeSessions } from '@/hooks/useCodeSessions'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { createImageAttachment } from '@/types/attachment'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  MAX_PREVIEW_BYTES,
  basenameOf,
  isAssetKind,
  resolveInRoot,
  previewKindFor,
  unresolvedRefs,
  type PreviewState,
} from '@/lib/codePreview'
import type { BundledLanguage } from 'shiki'

/** Kinds that can be meaningfully annotated (visual content). */
const ANNOTATABLE_KINDS = new Set(['html', 'svg', 'image', 'markdown'])

/**
 * Preview pane for files the agent produced (jan-internal #242). Reads from disk
 * on demand, so `Reload` is inherently fresh — nothing is cached behind a URL
 * that could serve a stale copy.
 *
 * The FSM lives in `lib/codePreview.ts` and is shared with the artifacts library
 * (#304) so both surfaces behave the same way.
 */
export function CodePreviewPanel({
  files,
  root,
  selectedPath,
  onSelect,
  onClose,
}: {
  files: string[]
  root: string | null
  /** Driven by the caller so a transcript artifact card can open a file here. */
  selectedPath: string | null
  onSelect: (path: string | null) => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const currentId = useCodeSessions((s) => s.currentId)
  const setAttachments = useChatAttachments((s) => s.setAttachments)
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const [annotate, setAnnotate] = useState(false)

  const load = useCallback(
    async (rel: string) => {
      if (!root) return
      // The agent reports relative or absolute paths; either is fine as long as
      // it lands inside the project root.
      const abs = resolveInRoot(root, rel)
      if (!abs) {
        setState({ status: 'failed', path: rel, reason: t('common:previewOutsideRoot') })
        return
      }
      const kind = previewKindFor(rel)
      if (kind === 'file') {
        setState({ status: 'unsupported', path: rel })
        return
      }
      setState({ status: 'loading', path: rel })
      try {
        if (isAssetKind(kind)) {
          // Images/video/audio stream through the asset protocol; `read_file_sync` is
          // `read_to_string` on the Rust side and fails outright on binary.
          setState({
            status: 'ready',
            path: rel,
            kind,
            assetUrl: serviceHub.core().convertFileSrc(abs),
          })
          return
        }
        const stat = await fs.fileStat(abs)
        if (!stat) {
          setState({ status: 'failed', path: rel, reason: t('common:previewMissing') })
          return
        }
        if ((stat.size ?? 0) > MAX_PREVIEW_BYTES) {
          setState({ status: 'failed', path: rel, reason: t('common:previewTooLarge') })
          return
        }
        const raw = await fs.readFileSync(abs)
        const content = typeof raw === 'string' ? raw : String(raw)
        setState({
          status: 'ready',
          path: rel,
          kind,
          content,
          // Only meaningful for html: the sandbox has no base URL.
          unresolvedRefs: kind === 'html' ? unresolvedRefs(content) : 0,
        })
      } catch {
        // A read can fail because the file vanished mid-run, is binary, or is
        // not readable. All of them are the same thing to the user.
        setState({ status: 'failed', path: rel, reason: t('common:previewUnreadable') })
      }
    },
    [root, serviceHub, t]
  )

  const handleAnnotateSend = useCallback(
    (dataUrl: string) => {
      if (!currentId) {
        toast.error('No active session')
        return
      }
      const sid = currentId
      // Compute a rough byte length from the data URL (base64 inflates ~33%).
      const base64 = dataUrl.split(',')[1] ?? ''
      const size = Math.ceil((base64.length * 3) / 4)
      setAttachments(sid, (prev) => [
        ...prev,
        createImageAttachment({
          name: 'annotation.png',
          base64,
          dataUrl,
          mimeType: 'image/png',
          size,
        }),
      ])
      toast.success('Annotation added to message')
    },
    [currentId, setAttachments]
  )

  const canAnnotate =
    state.status === 'ready' &&
    state.kind != null &&
    ANNOTATABLE_KINDS.has(state.kind)

  // Load whenever the caller changes the selection (file list click, or a
  // transcript artifact card opening a specific file).
  useEffect(() => {
    if (selectedPath) void load(selectedPath)
    else setState({ status: 'idle' })
  }, [selectedPath, load])

  // Switching project root can never leave another project's file on screen.
  useEffect(() => {
    onSelect(null)
    setState({ status: 'idle' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  return (
    <CodeSidePanel
      title={t('common:previewPanelTitle')}
      summary={
        state.status === 'ready' || state.status === 'unsupported' ? (
          <div className="flex items-center gap-1">
            {canAnnotate && (
              <button
                type="button"
                onClick={() => setAnnotate((v) => !v)}
                title={annotate ? 'Exit annotation mode' : 'Annotate preview'}
                aria-label={annotate ? 'Exit annotation mode' : 'Annotate preview'}
                className={cn(
                  'shrink-0 rounded p-0.5 text-main-view-fg/60 hover:bg-main-view-fg/10 hover:text-main-view-fg',
                  annotate && 'bg-main-view-fg/10 text-main-view-fg'
                )}
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => selectedPath && void load(selectedPath)}
              title={t('common:previewReload')}
              aria-label={t('common:previewReload')}
              className="shrink-0 text-main-view-fg/60 hover:text-main-view-fg"
            >
              <RotateCw size={14} />
            </button>
          </div>
        ) : null
      }
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        {/* File list: what the agent wrote this session. */}
        <div className="max-h-40 shrink-0 overflow-y-auto border-b px-2 py-1.5">
          {files.length === 0 ? (
            <p className="px-1 py-0.5 text-xs text-main-view-fg/50">
              {t('common:previewNoFiles')}
            </p>
          ) : (
            files.map((rel) => (
              <button
                key={rel}
                type="button"
                onClick={() => onSelect(rel)}
                title={rel}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] hover:bg-main-view-fg/5',
                  selectedPath === rel && 'bg-main-view-fg/[0.07] font-medium'
                )}
              >
                <FileIcon size={12} className="shrink-0 text-main-view-fg/40" />
                <span className="truncate">{basenameOf(rel)}</span>
              </button>
            ))
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {state.status === 'idle' && (
            <p className="p-3 text-sm text-main-view-fg/50">{t('common:previewPickFile')}</p>
          )}
          {state.status === 'loading' && (
            <p className="p-3 text-sm text-main-view-fg/50">{t('common:previewLoading')}</p>
          )}
          {state.status === 'failed' && (
            <div className="flex items-start gap-2 p-3 text-sm">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-main-view-fg/50" />
              <span>
                <span className="block font-medium">{basenameOf(state.path)}</span>
                <span className="text-main-view-fg/60">{state.reason}</span>
              </span>
            </div>
          )}
          {state.status === 'unsupported' && (
            <div className="flex flex-col items-start gap-2 p-3">
              <span className="text-sm font-medium">{basenameOf(state.path)}</span>
              <span className="text-xs text-main-view-fg/60">
                {t('common:previewUnsupported')}
              </span>
              {root && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5"
                  onClick={() =>
                    void serviceHub.opener().revealItemInDir(resolveInRoot(root, state.path) ?? root)
                  }
                >
                  <FolderOpen size={13} />
                  {t('common:previewReveal')}
                </Button>
              )}
            </div>
          )}
          {state.status === 'ready' && (
            <div className="flex h-full flex-col">
              {!!state.unresolvedRefs && (
                // Say it, rather than presenting a broken page as correct.
                <p className="flex items-start gap-1.5 border-b bg-main-view-fg/[0.04] px-3 py-1.5 text-[11px] text-main-view-fg/70">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {t('common:previewUnresolvedRefs', { count: state.unresolvedRefs })}
                </p>
              )}
              <AnnotationOverlay
                active={annotate && canAnnotate}
                onSend={handleAnnotateSend}
                onCancel={() => setAnnotate(false)}
              >
                <div className="min-h-0 flex-1 overflow-auto">
                  {state.kind === 'html' && (
                    <HtmlArtifact code={state.content ?? ''} language="html" />
                  )}
                  {state.kind === 'svg' && (
                    <HtmlArtifact
                      code={state.content ?? ''}
                      language="xml"
                      allowScripts={false}
                    />
                  )}
                  {state.kind === 'markdown' && (
                    <div className="p-3">
                      <RenderMarkdown content={state.content ?? ''} />
                    </div>
                  )}
                  {state.kind === 'text' && (
                    <CodeBlock
                      code={state.content ?? ''}
                      language={
                        (previewKindFor(state.path) === 'text'
                          ? state.path.split('.').pop()
                          : 'text') as BundledLanguage
                      }
                    />
                  )}
                  {state.kind === 'image' && (
                    <img
                      src={state.assetUrl}
                      alt={basenameOf(state.path)}
                      className="max-h-full max-w-full object-contain p-3"
                    />
                  )}
                  {state.kind === 'video' && (
                    <video src={state.assetUrl} controls className="max-h-full max-w-full p-3" />
                  )}
                  {state.kind === 'audio' && (
                    <audio src={state.assetUrl} controls className="w-full p-3" />
                  )}
                </div>
              </AnnotationOverlay>
            </div>
          )}
        </div>
      </div>
    </CodeSidePanel>
  )
}
