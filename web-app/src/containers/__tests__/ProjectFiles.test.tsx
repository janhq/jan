import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---------- Module mocks (must come before importing the component) ----------

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => (opts?.defaultValue ?? key),
  }),
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: toastMock }))

// useAttachments selector mock
const hoisted = vi.hoisted(() => ({
  attachmentsState: { enabled: true, maxFileSizeMB: 10 },
  listAttachmentsForProjectMock: vi.fn(),
  deleteFileForProjectMock: vi.fn(),
  ingestFileAttachmentForProjectMock: vi.fn(),
  dialogOpenMock: vi.fn(),
  extMock: {} as any,
}))
hoisted.extMock.listAttachmentsForProject = hoisted.listAttachmentsForProjectMock
hoisted.extMock.deleteFileForProject = hoisted.deleteFileForProjectMock

const {
  listAttachmentsForProjectMock,
  deleteFileForProjectMock,
  ingestFileAttachmentForProjectMock,
  dialogOpenMock,
  extMock,
} = hoisted
const attachmentsStateRef = hoisted // alias for later mutation

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: (selector: any) => selector(hoisted.attachmentsState),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    uploads: () => ({
      ingestFileAttachmentForProject: hoisted.ingestFileAttachmentForProjectMock,
    }),
    dialog: () => ({ open: hoisted.dialogOpenMock }),
  }),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => hoisted.extMock,
    }),
  },
}))

vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: { VectorDB: 'vectordb' },
  VectorDBExtension: class {},
  fs: {
    fileStat: vi.fn().mockResolvedValue({ isDirectory: false, size: 100 }),
    readdirSync: vi.fn().mockResolvedValue([]),
  },
}))

// Stub heavy UI
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}))
vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: any) => <div data-testid="progress" data-value={value} />,
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

// Now import the component
import ProjectFiles from '../ProjectFiles'

describe('ProjectFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    attachmentsStateRef.attachmentsState = { enabled: true, maxFileSizeMB: 10 }
    extMock.listAttachmentsForProject = listAttachmentsForProjectMock
    extMock.deleteFileForProject = deleteFileForProjectMock
    listAttachmentsForProjectMock.mockResolvedValue([])
  })

  it('shows loader while files are loading', () => {
    listAttachmentsForProjectMock.mockImplementation(
      () => new Promise(() => {})
    )
    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('renders empty state when no files are returned', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([])
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
  })

  it('renders a file list when files exist', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([
      { id: '1', name: 'report.pdf', path: '/x/report.pdf', size: 2048, chunk_count: 3 },
      { id: '2', name: 'notes.txt', path: '/x/notes.txt', size: 100, chunk_count: 0 },
    ])
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getAllByText('report.pdf').length).toBeGreaterThan(0)
    )
    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0)
  })

  it('falls back to empty list when extension is missing', async () => {
    extMock.listAttachmentsForProject = undefined
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
  })

  it('falls back to empty list when the extension throws', async () => {
    listAttachmentsForProjectMock.mockRejectedValue(new Error('boom'))
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
  })

  it('shows an info toast when upload is clicked while attachments are disabled', async () => {
    attachmentsStateRef.attachmentsState = { enabled: false, maxFileSizeMB: 10 }
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() => expect(screen.getByText('Upload')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Upload'))
    await waitFor(() => expect(toastMock.info).toHaveBeenCalled())
    expect(dialogOpenMock).not.toHaveBeenCalled()
  })

  it('opens the file dialog when upload is clicked', async () => {
    dialogOpenMock.mockResolvedValue(null)
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() => expect(screen.getByText('Upload')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Upload'))
    await waitFor(() => expect(dialogOpenMock).toHaveBeenCalled())
  })

  it('toasts error when opening the dialog throws', async () => {
    dialogOpenMock.mockRejectedValue(new Error('dialog broken'))
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() => expect(screen.getByText('Upload')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Upload'))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
  })

  it('deletes a file and reloads the list', async () => {
    listAttachmentsForProjectMock.mockResolvedValueOnce([
      { id: 'f1', name: 'a.md', path: '/a.md', size: 10, chunk_count: 1 },
    ])
    listAttachmentsForProjectMock.mockResolvedValueOnce([])
    deleteFileForProjectMock.mockResolvedValue(undefined)

    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getAllByText('a.md').length).toBeGreaterThan(0)
    )

    // The trash button is the 2nd button (first is Upload)
    const buttons = container.querySelectorAll('button')
    // Last button in a file row is the delete button
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(deleteFileForProjectMock).toHaveBeenCalledWith('p1', 'f1'))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
  })

  it('toasts error when deletion fails', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([
      { id: 'f1', name: 'a.md', path: '/a.md', size: 10, chunk_count: 1 },
    ])
    deleteFileForProjectMock.mockRejectedValue(new Error('nope'))

    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getAllByText('a.md').length).toBeGreaterThan(0)
    )
    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
  })

  it('shows chunk count when greater than zero', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([
      { id: '1', name: 'x.md', size: 1024, chunk_count: 5 },
    ])
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getAllByText('x.md').length).toBeGreaterThan(0)
    )
    expect(screen.getByText(/common:files.chunksCount/)).toBeInTheDocument()
  })

  it('prevents default on drag over and leave without crashing', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([])
    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
    const dropzone = container.querySelector('.border-dashed') as HTMLElement
    expect(dropzone).toBeTruthy()
    fireEvent.dragOver(dropzone)
    fireEvent.dragLeave(dropzone)
  })

  it('handles a drop event with no files gracefully', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([])
    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
    const dropzone = container.querySelector('.border-dashed') as HTMLElement
    fireEvent.drop(dropzone, { dataTransfer: { items: [], files: [] } })
    // No error thrown, no ingest called
    expect(ingestFileAttachmentForProjectMock).not.toHaveBeenCalled()
  })

  it('shows info toast on drop when attachments are disabled', async () => {
    attachmentsStateRef.attachmentsState = { enabled: false, maxFileSizeMB: 10 }
    listAttachmentsForProjectMock.mockResolvedValue([])
    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
    const dropzone = container.querySelector('.border-dashed') as HTMLElement
    fireEvent.drop(dropzone, { dataTransfer: { items: [], files: [] } })
    await waitFor(() => expect(toastMock.info).toHaveBeenCalled())
  })
})
