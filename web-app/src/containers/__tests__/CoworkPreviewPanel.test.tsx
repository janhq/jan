import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${k}#${opts.count}` : k,
  }),
}))

const convertFileSrc = vi.fn((p: string, protocol?: string) =>
  protocol ? `${protocol}://localhost${p}` : `asset://${p}`
)
const previewRegisterRoot = vi.fn(async () => {})
const previewUnregisterRoot = vi.fn(async () => {})
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  previewRegisterRoot: (...a: unknown[]) => previewRegisterRoot(...a),
  previewUnregisterRoot: (...a: unknown[]) => previewUnregisterRoot(...a),
}))
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
    previewRegisterRoot.mockClear()
    previewUnregisterRoot.mockClear()
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

  // A page built on a CDN script renders nothing while network is off; the
  // pane says why and names the toggle, and the notice goes once it is on.
  it('says when web resources are blocked, until network is allowed', async () => {
    respondWith('<script src="https://cdn.example/phaser.js"></script><canvas></canvas>')
    view('game.html')

    await screen.findByText('common:preview.externalRefs#1')
    fireEvent.click(screen.getByLabelText('common:preview.allowNetwork'))
    await waitFor(() =>
      expect(screen.queryByText('common:preview.externalRefs#1')).toBeNull()
    )
  })

  it('does not mention blocked resources for a self-contained page', async () => {
    respondWith('<canvas></canvas><script>run()</script>')
    view('game.html')

    await screen.findByTitle('game.html')
    expect(screen.queryByText(/externalRefs/)).toBeNull()
  })

  // The sandbox swallows exceptions; the shim posts them and the pane shows
  // the first, deduplicated, so a blank page comes with a reason.
  it('surfaces errors the page reports through the shim', async () => {
    respondWith('<script>throw new Error("boom")</script>')
    view('game.html')

    const frame = (await screen.findByTitle('game.html')) as HTMLIFrameElement
    expect(frame.srcdoc).toContain('jan-preview-shim')
    const report = (message: string) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { source: 'jan-preview-shim', type: 'error', message },
            source: frame.contentWindow,
          })
        )
      })
    report('boom')
    report('boom')
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe(
      'common:preview.scriptErrors#1'
    )
    report('later')
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'common:preview.scriptErrors#2'
      )
    )
  })

  it('ignores a report from a window that is not the previewed frame', async () => {
    respondWith('<p>ok</p>')
    view('page.html')

    await screen.findByTitle('page.html')
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'jan-preview-shim', type: 'error', message: 'x' },
          source: window,
        })
      )
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The unsandboxed mode trades the srcdoc sandbox for the scheme's own
  // origin. The scheme serves nothing until the pane registers the root, the
  // network flag travels with that registration, and closing withdraws it.
  it('serves the page from preview:// with its own origin when unsandboxed', async () => {
    respondWith('<canvas></canvas><script>run()</script>')
    const { unmount } = view('game.html')
    await screen.findByTitle('game.html')

    fireEvent.click(screen.getByLabelText('common:preview.unsandboxed'))
    const frame = (await waitFor(() => {
      const f = screen.getByTitle('game.html') as HTMLIFrameElement
      expect(f.getAttribute('src')).toBeTruthy()
      return f
    })) as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(`preview://localhost${ROOT}/game.html`)
    expect(frame.getAttribute('sandbox')).toContain('allow-same-origin')
    expect(frame.srcdoc).toBe('')
    await waitFor(() =>
      expect(previewRegisterRoot).toHaveBeenLastCalledWith(ROOT, false)
    )

    fireEvent.click(screen.getByLabelText('common:preview.allowNetwork'))
    await waitFor(() =>
      expect(previewRegisterRoot).toHaveBeenLastCalledWith(ROOT, true)
    )

    unmount()
    expect(previewUnregisterRoot).toHaveBeenCalledWith(ROOT)
  })

  it('registers nothing while the sandbox is in use', async () => {
    respondWith('<p>ok</p>')
    view('page.html')
    await screen.findByTitle('page.html')
    expect(previewRegisterRoot).not.toHaveBeenCalled()
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
