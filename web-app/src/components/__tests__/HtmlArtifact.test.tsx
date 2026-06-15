import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HtmlArtifact } from '../HtmlArtifact'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}))

vi.mock('@/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) => (
    <pre data-testid="code-block" data-language={language}>
      {code}
    </pre>
  ),
}))

const HTML = '<h1>hi</h1><script>document.title="x"</script>'

describe('HtmlArtifact', () => {
  it('defaults to the Preview view', () => {
    render(<HtmlArtifact code={HTML} />)
    expect(screen.getByTestId('html-artifact-iframe')).toBeInTheDocument()
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  it('switches back to the Code view on demand', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifact code={HTML} />)
    await user.click(screen.getByRole('tab', { name: /code/i }))
    expect(screen.getByTestId('code-block')).toBeInTheDocument()
    expect(screen.queryByTestId('html-artifact-iframe')).not.toBeInTheDocument()
  })

  it('mounts a sandboxed iframe with no allow-same-origin on Preview', () => {
    render(<HtmlArtifact code={HTML} />)
    const iframe = screen.getByTestId('html-artifact-iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('injects a strict CSP that blocks network by default', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifact code={HTML} />)
    await user.click(screen.getByRole('tab', { name: /preview/i }))

    const iframe = screen.getByTestId('html-artifact-iframe') as HTMLIFrameElement
    const doc = iframe.getAttribute('srcdoc') ?? ''
    expect(doc).toContain('Content-Security-Policy')
    expect(doc).toContain("connect-src 'none'")
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain(HTML)
  })

  it('drops allow-scripts and forbids scripts in static (svg) mode', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifact code="<svg/>" allowScripts={false} language="xml" />)
    const iframe = screen.getByTestId(
      'html-artifact-iframe'
    ) as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('')

    await user.click(screen.getByRole('tab', { name: /preview/i }))
    const doc = iframe.getAttribute('srcdoc') ?? ''
    expect(doc).not.toContain('script-src')
    expect(doc).toContain("default-src 'none'")

    await user.click(screen.getByRole('tab', { name: /code/i }))
    expect(screen.getByTestId('code-block').getAttribute('data-language')).toBe(
      'xml'
    )
  })

  it('relaxes CSP for network when allowNetwork is set', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifact code={HTML} allowNetwork />)
    await user.click(screen.getByRole('tab', { name: /preview/i }))

    const iframe = screen.getByTestId('html-artifact-iframe') as HTMLIFrameElement
    const doc = iframe.getAttribute('srcdoc') ?? ''
    expect(doc).toContain('connect-src https:')
    expect(doc).not.toContain("connect-src 'none'")
  })

  it('disables Preview and stays on Code while streaming', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifact code={HTML} isStreaming />)

    const previewTab = screen.getByRole('tab', { name: /preview/i })
    expect(previewTab).toBeDisabled()

    await user.click(previewTab)
    expect(screen.queryByTestId('html-artifact-iframe')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-block')).toBeInTheDocument()
  })

  it('preserves an existing <head> when injecting CSP', async () => {
    const user = userEvent.setup()
    const fullDoc = '<html><head><title>t</title></head><body>x</body></html>'
    render(<HtmlArtifact code={fullDoc} />)
    await user.click(screen.getByRole('tab', { name: /preview/i }))

    const iframe = screen.getByTestId('html-artifact-iframe') as HTMLIFrameElement
    const doc = iframe.getAttribute('srcdoc') ?? ''
    expect(doc).toContain('<title>t</title>')
    expect((doc.match(/<head/gi) ?? []).length).toBe(1)
  })
})
