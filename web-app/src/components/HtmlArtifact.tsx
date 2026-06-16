import { memo, useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { CodeIcon, EyeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/ai-elements/code-block'
import type { BundledLanguage } from 'shiki'

interface HtmlArtifactProps {
  code: string
  className?: string
  /**
   * When true the live preview cannot be opened yet (content still streaming).
   * The toggle stays on the Code view and the Preview tab is disabled.
   */
  isStreaming?: boolean
  /**
   * Relax the iframe CSP to permit https: scripts/styles/fonts/images and
   * outbound connections. Off by default: model-generated HTML runs with no
   * network access so it cannot phone home or pull remote payloads.
   */
  allowNetwork?: boolean
  /**
   * Static mode for SVG: no scripts at all (CSP script-src 'none' and the
   * iframe drops allow-scripts). Code view highlights as the given language.
   */
  allowScripts?: boolean
  language?: string
}

type View = 'code' | 'preview'

/**
 * Strict CSP keeps model HTML inert on the network. The iframe already runs in
 * an opaque origin (sandbox without allow-same-origin), so this only governs
 * what the document itself may reach out to.
 */
function buildCsp(allowNetwork: boolean, allowScripts: boolean): string {
  if (!allowScripts) {
    return [
      "default-src 'none'",
      'img-src data: blob:',
      "style-src 'unsafe-inline'",
      'font-src data:',
      "connect-src 'none'",
    ].join('; ')
  }
  if (allowNetwork) {
    return [
      "default-src 'none'",
      "script-src 'unsafe-inline' https:",
      "style-src 'unsafe-inline' https:",
      'img-src data: blob: https:',
      'font-src data: https:',
      'connect-src https:',
    ].join('; ')
  }
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
  ].join('; ')
}

function buildSrcDoc(
  code: string,
  allowNetwork: boolean,
  allowScripts: boolean
): string {
  const csp = buildCsp(allowNetwork, allowScripts)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  if (/<head[\s>]/i.test(code)) {
    return code.replace(/<head([^>]*)>/i, `<head$1>${meta}`)
  }
  if (/<html[\s>]/i.test(code)) {
    return code.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`)
  }
  return `<!doctype html><html><head>${meta}</head><body>${code}</body></html>`
}

function HtmlArtifactComponent({
  code,
  className,
  isStreaming,
  allowNetwork = false,
  allowScripts = true,
  language = 'html',
}: HtmlArtifactProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('preview')

  const srcDoc = useMemo(
    () =>
      view === 'preview' ? buildSrcDoc(code, allowNetwork, allowScripts) : '',
    [view, code, allowNetwork, allowScripts]
  )

  const previewDisabled = isStreaming ?? false
  const activeView: View = previewDisabled ? 'code' : view

  const tabClass = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
      active
        ? 'text-foreground border-b-2 border-primary'
        : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'
    )

  return (
    <div
      className={cn(
        'my-4 overflow-hidden rounded-xl border border-border bg-background',
        className
      )}
      data-testid="html-artifact"
    >
      <div
        className="flex items-center gap-1 border-b border-border px-2"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'code'}
          className={tabClass(activeView === 'code')}
          onClick={() => setView('code')}
        >
          <CodeIcon size={14} />
          {t('htmlArtifact.code')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'preview'}
          disabled={previewDisabled}
          title={
            previewDisabled ? t('htmlArtifact.previewStreaming') : undefined
          }
          className={cn(
            tabClass(activeView === 'preview'),
            previewDisabled && 'cursor-not-allowed opacity-50'
          )}
          onClick={() => setView('preview')}
        >
          <EyeIcon size={14} />
          {t('htmlArtifact.preview')}
        </button>
      </div>

      {activeView === 'preview' ? (
        <iframe
          title={t('htmlArtifact.preview')}
          data-testid="html-artifact-iframe"
          className="h-[600px] max-h-[80vh] min-h-64 w-full resize-y overflow-auto border-0 bg-white"
          sandbox={allowScripts ? 'allow-scripts' : ''}
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
        />
      ) : (
        <CodeBlock code={code} language={language as BundledLanguage} />
      )}
    </div>
  )
}

export const HtmlArtifact = memo(HtmlArtifactComponent)
