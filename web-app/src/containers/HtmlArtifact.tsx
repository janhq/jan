import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
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
  fill?: boolean
  onClose?: () => void
  streaming?: boolean
}

const DEFAULT_FILENAME = 'artifact.html'

function buildPreviewDocument(code: string): string {
  const isFullDocument = /<html[\s>]/i.test(code) || /<!doctype/i.test(code)
  if (isFullDocument) return code

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"></head><body>${code}</body></html>`
}

// The preview iframe is sandboxed without `allow-same-origin`; a blob: document
// would inherit the strict main-window CSP and silently drop inline scripts. On
// Tauri we instead serve the document through the `artifact://` protocol, which
// carries its own permissive CSP. Windows exposes custom schemes as
// `http://<scheme>.localhost`.
function artifactBaseUrl(): string {
  return navigator.userAgent.includes('Windows')
    ? 'http://artifact.localhost'
    : 'artifact://localhost'
}

function createArtifactId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `art-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function estimateHtmlProgress(code: string): number {
  if (!code) return 0.04

  const has = (re: RegExp) => re.test(code)
  if (has(/<\/html>/i)) return 1
  if (has(/<\/body>/i)) return 0.95

  let base = 0.06
  let ceil = 0.18
  if (has(/<!doctype|<html[\s>]/i)) {
    base = 0.12
    ceil = 0.3
  }
  if (has(/<head[\s>]/i)) {
    base = 0.22
    ceil = 0.45
  }
  if (has(/<\/head>/i)) {
    base = 0.45
    ceil = 0.6
  }
  if (has(/<body[\s>]/i)) {
    base = 0.6
    ceil = 0.92
  }

  // Asymptotic creep toward (but never reaching) the next milestone.
  const creep = 1 - 1 / (1 + code.length / 2200)
  return Math.min(ceil, base + (ceil - base) * creep)
}

type ArtifactTab = 'preview' | 'code'

function HtmlArtifactComponent({
  code,
  className,
  fill = false,
  onClose,
  streaming = false,
}: HtmlArtifactProps) {
  const [tab, setTab] = useState<ArtifactTab>('preview')
  const [copied, setCopied] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [progress, setProgress] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const artifactIdRef = useRef<string>('')
  if (!artifactIdRef.current) artifactIdRef.current = createArtifactId()
  const versionRef = useRef(0)

  const [codeIdle, setCodeIdle] = useState(false)
  useEffect(() => {
    setCodeIdle(false)
    const timer = setTimeout(() => setCodeIdle(true), 2000)
    return () => clearTimeout(timer)
  }, [code])

  // Don't trust `streaming` alone; it can stay stuck true after a re-mount.
  const docComplete = /<\/html>/i.test(code)
  const generating = streaming && !docComplete && !codeIdle

  // Web: blob preview is handled internally by the browser, so it's safe to
  // refresh on every debounced change.
  useEffect(() => {
    if (isPlatformTauri()) return
    const timer = setTimeout(() => {
      const url = URL.createObjectURL(
        new Blob([buildPreviewDocument(code)], { type: 'text/html' })
      )
      setPreviewUrl((previous) => {
        if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
        return url
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [code])

  // Tauri: serve through the artifact:// protocol, but navigate the iframe only
  // once the stream has settled. Re-navigating a custom-scheme iframe on every
  // streamed token races WKURLSchemeTask in WKWebView and aborts the app, so we
  // load the frame a single time per settled document (the loader covers the
  // generating phase anyway).
  const navigatedCodeRef = useRef('')
  useEffect(() => {
    if (!isPlatformTauri()) return
    if (generating || !code || navigatedCodeRef.current === code) return
    let cancelled = false
    void (async () => {
      try {
        await invoke('set_artifact_html', {
          id: artifactIdRef.current,
          html: buildPreviewDocument(code),
        })
        if (cancelled) return
        navigatedCodeRef.current = code
        versionRef.current += 1
        setPreviewUrl(
          `${artifactBaseUrl()}/${artifactIdRef.current}?v=${versionRef.current}`
        )
      } catch (error) {
        console.error('Failed to register artifact preview:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, generating])

  // Watchdog forces the loader to clear if the iframe never fires `load`.
  useEffect(() => {
    if (!previewUrl) return
    setFrameLoaded(false)
    const watchdog = setTimeout(() => setFrameLoaded(true), 4000)
    return () => clearTimeout(watchdog)
  }, [previewUrl])

  useEffect(() => {
    if (!generating) {
      setProgress(1)
      return
    }
    setProgress((previous) => Math.max(previous, estimateHtmlProgress(code)))
  }, [code, generating])

  const showPreviewLoader = generating || !previewUrl || !frameLoaded
  const progressPct = Math.round((generating ? progress : 1) * 100)

  useEffect(() => {
    const id = artifactIdRef.current
    return () => {
      if (isPlatformTauri()) {
        invoke('clear_artifact_html', { id }).catch(() => {})
      }
      setPreviewUrl((previous) => {
        if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
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
      <div className="@container flex items-center justify-between gap-2 border-border border-b bg-muted/60 px-2 py-1.5">
        <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
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
            <Eye size={14} className="shrink-0" />
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
            <Code2 size={14} className="shrink-0" />
            Code
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleCopy}
            title="Copy code"
          >
            <CopyIcon size={14} className="shrink-0" />
            <span className="hidden @[26rem]:inline">
              {copied ? 'Copied' : 'Copy'}
            </span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleDownload}
            title="Download as .html"
          >
            <Download size={14} className="shrink-0" />
            <span className="hidden @[26rem]:inline">Download</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handlePrint}
            title="Print / Save as PDF"
          >
            <Printer size={14} className="shrink-0" />
            <span className="hidden @[26rem]:inline">Print</span>
          </Button>
          {onClose && (
            <Button
              size="icon"
              variant="ghost"
              className="ml-1 h-7 w-7 shrink-0"
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
          src={previewUrl || undefined}
          onLoad={() => setFrameLoaded(true)}
          sandbox="allow-scripts allow-modals allow-forms allow-popups"
          title="HTML preview"
          className={cn(
            'w-full border-0 bg-white',
            fill ? 'h-full' : 'h-[440px]'
          )}
        />
        {showPreviewLoader && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-8 text-muted-foreground">
            <div className="h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-sm tabular-nums">
              {generating
                ? `Generating preview… ${progressPct}%`
                : 'Rendering preview…'}
            </span>
          </div>
        )}
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
  (prev, next) =>
    prev.code === next.code &&
    prev.className === next.className &&
    prev.streaming === next.streaming
)
