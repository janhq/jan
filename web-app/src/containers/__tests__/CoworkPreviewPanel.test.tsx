import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${k}#${opts.count}` : k,
  }),
}))

const convertFileSrc = vi.fn((p: string) => `asset://${p}`)
const openPath = vi.fn()
const revealItemInDir = vi.fn()
const hub = {
  core: () => ({ convertFileSrc }),
  opener: () => ({ openPath, revealItemInDir }),
}
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => hub,
  getServiceHub: () => hub,
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}))

import { CoworkPreviewPanel } from '../CoworkPreviewPanel'
import { MAX_PREVIEW_BYTES } from '@/lib/coworkPreview'

const ROOT = '/data/agent-workspace/sessions/s1'

const respondWith = (body: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: { get: () => String(body.length) },
      text: async () => body,
    }))
  )
}

const view = (path: string) =>
  render(<CoworkPreviewPanel root={ROOT} path={path} onClose={vi.fn()} />)

describe('CoworkPreviewPanel', () => {
  beforeEach(() => {
    convertFileSrc.mockClear()
    vi.unstubAllGlobals()
  })

  // The one security-relevant behaviour: the panel is handed paths the model
  // chose, and must never read one that leaves the sandbox.
  it('refuses a path that escapes the workspace instead of reading it', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    view('../../../etc/passwd')

    await screen.findByText('common:preview.outside')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(convertFileSrc).not.toHaveBeenCalled()
  })

  it('streams an image from disk rather than fetching it', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    view('chart.png')

    const img = await screen.findByRole('img')
    expect(img).toHaveAttribute('src', `asset://${ROOT}/chart.png`)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Scripts on (a chart artifact is inert without them), network off until
  // asked for -- so model markup cannot phone out on open.
  it('sandboxes html with scripts allowed and network withheld', async () => {
    respondWith('<h1>Report</h1><script>draw()</script>')
    view('report.html')

    const frame = (await screen.findByTitle('report.html')) as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.srcdoc).toContain("script-src 'unsafe-inline'")
    expect(frame.srcdoc).not.toContain('https:')
    expect(frame.srcdoc).toContain('<h1>Report</h1>')
  })

  it('runs no scripts for an svg', async () => {
    respondWith('<svg><rect /></svg>')
    view('logo.svg')

    const frame = (await screen.findByTitle('logo.svg')) as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.srcdoc).toContain("default-src 'none'")
  })

  // A page whose relative assets cannot resolve renders visibly broken; saying
  // so beats presenting it as correct.
  it('counts links the sandbox cannot resolve', async () => {
    respondWith('<img src="a.png"><img src="https://x.dev/b.png">')
    view('page.html')

    await screen.findByText('common:preview.unresolvedRefs#1')
  })

  it('renders markdown through the shared renderer', async () => {
    respondWith('# Title')
    view('notes.md')

    expect(await screen.findByTestId('markdown')).toHaveTextContent('# Title')
  })

  it('offers another app instead of previewing an unsupported file', async () => {
    view('archive.zip')
    await screen.findByText('common:preview.unsupported')
  })

  it('stops before loading a file too big to preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => String(MAX_PREVIEW_BYTES + 1) },
        text: async () => 'x',
      }))
    )
    view('huge.html')
    await screen.findByText('common:preview.tooLarge')
  })

  it('reports a read failure rather than rendering an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => '0' } }))
    )
    view('gone.html')
    await waitFor(() => expect(screen.getByText('404')).toBeInTheDocument())
  })
})
