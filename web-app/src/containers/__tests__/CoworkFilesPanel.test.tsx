import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k} ${Object.values(opts).join(' ')}` : k,
  }),
}))

import { CoworkFilesPanel } from '../CoworkFilesPanel'
import { CoworkFilesChip } from '../CoworkFilesChip'
import { artifactFor } from '@/lib/coworkArtifacts'

const pdf = {
  name: 'spec.pdf',
  path: '/home/me/spec.pdf',
  fileType: 'pdf',
  workspacePath: '/ws/attachments/spec.pdf',
}
const lost = { name: 'gone.docx', path: '/home/me/gone.docx', fileType: 'docx' }
const html = artifactFor('site/index.html')!
const png = artifactFor('chart.png')!

describe('CoworkFilesChip', () => {
  it('renders nothing with no files, and the count otherwise', () => {
    const { container } = render(
      <CoworkFilesChip count={0} open={false} onToggle={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
    render(<CoworkFilesChip count={3} open={true} onToggle={vi.fn()} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('CoworkFilesPanel', () => {
  it('shows the empty notice with nothing to list', () => {
    render(
      <CoworkFilesPanel
        attachments={[]}
        artifacts={[]}
        onPreview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('common:files.empty')).toBeInTheDocument()
  })

  it('groups attachments first, then artifacts by family', () => {
    render(
      <CoworkFilesPanel
        attachments={[pdf]}
        artifacts={[png, html]}
        onPreview={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const headers = screen
      .getAllByRole('button', { expanded: true })
      .map((b) => b.textContent)
    expect(headers[0]).toContain('common:files.attachments')
    expect(headers[1]).toContain('common:artifactGroupCode')
    expect(headers[2]).toContain('common:artifactGroupImage')
    expect(screen.getByText('spec.pdf')).toBeInTheDocument()
    expect(screen.getByText('index.html')).toBeInTheDocument()
    expect(screen.getByText('chart.png')).toBeInTheDocument()
  })

  it('previews a row by its workspace path, and folds a group', async () => {
    const onPreview = vi.fn()
    render(
      <CoworkFilesPanel
        attachments={[pdf, lost]}
        artifacts={[html]}
        onPreview={onPreview}
        onClose={vi.fn()}
      />
    )
    await userEvent.click(screen.getByText('spec.pdf'))
    expect(onPreview).toHaveBeenCalledWith('/ws/attachments/spec.pdf')
    await userEvent.click(screen.getByText('index.html'))
    expect(onPreview).toHaveBeenCalledWith('site/index.html')

    // Never imported: nothing to open, and the row says so.
    expect(screen.getByText('gone.docx').closest('button')).toBeDisabled()
    expect(screen.getByText('common:files.notImported')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: /common:files.attachments/ })
    )
    expect(screen.queryByText('spec.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('index.html')).toBeInTheDocument()
  })
})
