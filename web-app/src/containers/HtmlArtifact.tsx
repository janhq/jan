import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Code2, Copy, Download, Eye, Printer, X } from 'lucide-react'
import { fs } from '@janhq/core'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'

interface HtmlArtifactProps {
  code: string
  className?: string
  /**
   * Fill the parent height instead of using a fixed-height card. Used when the
   * artifact is hosted inside the side panel.
   */
  fill?: boolean
  /** When provided, renders a close button in the toolbar (side-panel mode). */
  onClose?: () => void
}

const DEFAULT_FILENAME = 'artifact.html'

/**
 * Wrap/normalize the model output into a complete HTML document for the iframe.
 * The original `code` is never mutated — this is only used to build the preview.
 */
function buildPreviewDocument(code: string): string {
  const isFullDocument = /<html[\s>]/i.test(code) || /<!doctype/i.test(code)
  if (isFullDocument) return code

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"></head><body>${code}</body></html>`
}

type ArtifactTab = 'preview' | 'code'

function HtmlArtifactComponent({
  code,
  className,
  fill = false,
  onClose,
}: HtmlArtifactProps) {
  const [tab, setTab] = useState<ArtifactTab>('preview')
  const [copied, setCopied] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)

  // Debounce document rebuilds so streaming output doesn't thrash the iframe.
  useEffect(() => {
    const timer = setTimeout(() => {
      const doc = buildPreviewDocument(code)
      const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }))
      setBlobUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return url
      })
    }, 250)

    return () => clearTimeout(timer)
  }, [code])

  // Revoke the last object URL on unmount.
  useEffect(() => {
    return () => {
      setBlobUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return ''
      })
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (!navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy artifact code:', error)
    }
  }, [code])

  const handleDownload = useCallback(async () => {
    // Desktop: native save dialog + filesystem write. The dialog returns null
    // when the user cancels, in which case we do nothing.
    if (isPlatformTauri()) {
      try {
        const path = await getServiceHub()
          .dialog()
          .save({
            defaultPath: DEFAULT_FILENAME,
            filters: [{ name: 'HTML File', extensions: ['html'] }],
          })
        if (path) {
          await fs.writeFileSync(path, code)
        }
        return
      } catch (error) {
        console.error('Failed to save artifact:', error)
        return
      }
    }

    // Web/mobile: trigger a browser download.
    try {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/html' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = DEFAULT_FILENAME
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download artifact:', error)
    }
  }, [code])

  const handlePrint = useCallback(() => {
    // Print from the parent window (where the user gesture lives) rather than
    // calling print() inside the sandboxed, opaque-origin iframe — that frame
    // has no user activation and WKWebView/WebView2 may silently ignore it.
    // A print-only stylesheet (see index.css `.artifact-printing`) hides the
    // app chrome and blows the preview iframe up to full page; the iframe's
    // painted content (incl. JS-rendered output) is captured as normal embedded
    // content even though it is cross-origin.
    const region = previewWrapRef.current
    if (!region) return

    setTab('preview')

    const cleanup = () => {
      region.classList.remove('artifact-print-region')
      document.body.classList.remove('artifact-printing')
      window.removeEventListener('afterprint', cleanup)
    }

    // Defer so the preview tab is mounted/visible before the print snapshot.
    setTimeout(() => {
      region.classList.add('artifact-print-region')
      document.body.classList.add('artifact-printing')
      window.addEventListener('afterprint', cleanup)
      try {
        window.print()
      } catch (error) {
        console.error('Failed to print artifact:', error)
        cleanup()
      }
    }, 60)
  }, [])

  const CopyIcon = copied ? Check : Copy

  return (
    <div
      className={cn(
        'overflow-hidden border-border bg-background',
        fill
          ? 'flex h-full w-full flex-col'
          : 'my-4 w-full rounded-xl border',
        className
      )}
      data-artifact="html"
    >
      <div className="flex items-center justify-between gap-2 border-border border-b bg-muted/60 px-2 py-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 transition-colors',
              tab === 'preview'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-background/60'
            )}
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setTab('code')}
            className={cn(
              'inline-flex items-center gap-1 border-border border-l px-2.5 py-1 transition-colors',
              tab === 'code'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-background/60'
            )}
          >
            <Code2 size={14} />
            Code
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleCopy}
            title="Copy code"
          >
            <CopyIcon size={14} />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleDownload}
            title="Download as .html"
          >
            <Download size={14} />
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handlePrint}
            title="Print / Save as PDF"
          >
            <Printer size={14} />
            Print
          </Button>
          {onClose && (
            <Button
              size="icon"
              variant="ghost"
              className="ml-1 h-7 w-7"
              onClick={onClose}
              title="Close"
            >
              <X size={14} />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={previewWrapRef}
        className={cn(
          'relative',
          fill && 'min-h-0 flex-1',
          tab === 'preview' ? 'block' : 'hidden'
        )}
      >
        <iframe
          ref={iframeRef}
          src={blobUrl || undefined}
          // Isolated preview: scripts may run, but the frame has no access to
          // app data, cookies, or the parent DOM (no allow-same-origin).
          sandbox="allow-scripts allow-modals allow-forms allow-popups"
          title="HTML preview"
          className={cn(
            'w-full border-0 bg-white',
            fill ? 'h-full' : 'h-[440px]'
          )}
        />
      </div>

      <div
        className={cn(
          fill && 'min-h-0 flex-1',
          tab === 'code' ? 'block' : 'hidden'
        )}
      >
        <div className={cn('overflow-auto', fill ? 'h-full' : 'max-h-[440px]')}>
          <CodeBlock code={code} language="html" />
        </div>
      </div>
    </div>
  )
}

export const HtmlArtifact = memo(
  HtmlArtifactComponent,
  (prev, next) => prev.code === next.code && prev.className === next.className
)
