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

const uploadsHoisted = vi.hoisted(() => ({
  ingestMock: vi.fn(),
  progress: {} as Record<string, { current: number; total: number }>,
}))
const { ingestMock } = uploadsHoisted
vi.mock('@/stores/project-uploads-store', () => ({
  useProjectUploads: (selector: (s: unknown) => unknown) =>
    selector({
      progress: uploadsHoisted.progress,
      completedTick: {},
      ingest: uploadsHoisted.ingestMock,
    }),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => hoisted.extMock,
    }),
  },
}))

const coreHoisted = vi.hoisted(() => ({
  fileStatMock: vi.fn(),
  readdirSyncMock: vi.fn(),
}))
const { fileStatMock, readdirSyncMock } = coreHoisted
vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: { VectorDB: 'vectordb' },
  VectorDBExtension: class {},
  fs: {
    fileStat: coreHoisted.fileStatMock,
    readdirSync: coreHoisted.readdirSyncMock,
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
    fileStatMock.mockReset().mockResolvedValue({ isDirectory: false, size: 100 })
    readdirSyncMock.mockReset().mockResolvedValue([])
    ingestMock.mockReset()
    uploadsHoisted.progress = {}
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
    await waitFor(() => expect(screen.getByText('common:projects.processButton')).toBeInTheDocument())
    fireEvent.click(screen.getByText('common:projects.processButton'))
    await waitFor(() => expect(toastMock.info).toHaveBeenCalled())
    expect(dialogOpenMock).not.toHaveBeenCalled()
  })

  it('opens the file dialog when upload is clicked', async () => {
    dialogOpenMock.mockResolvedValue(null)
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() => expect(screen.getByText('common:projects.processButton')).toBeInTheDocument())
    fireEvent.click(screen.getByText('common:projects.processButton'))
    await waitFor(() => expect(dialogOpenMock).toHaveBeenCalled())
  })

  it('toasts error when opening the dialog throws', async () => {
    dialogOpenMock.mockRejectedValue(new Error('dialog broken'))
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() => expect(screen.getByText('common:projects.processButton')).toBeInTheDocument())
    fireEvent.click(screen.getByText('common:projects.processButton'))
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

  // ---------- Upload flow: processFilePaths + ingest + humanizeUploadError ----------

  async function clickUpload() {
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.processButton')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('common:projects.processButton'))
  }

  const lastErrorDescription = () =>
    (toastMock.error.mock.calls.at(-1)?.[1] as { description?: string })
      ?.description

  it('ingests a selected file and toasts success', async () => {
    dialogOpenMock.mockResolvedValue(['/docs/report.pdf'])
    ingestMock.mockImplementation(async (_pid, atts, _fn, opts) => {
      expect(atts).toHaveLength(1)
      expect(atts[0]).toMatchObject({ path: '/docs/report.pdf', fileType: 'pdf' })
      opts.onSuccess()
    })
    await clickUpload()
    await waitFor(() => expect(ingestMock).toHaveBeenCalledWith(
      'p1', expect.any(Array), expect.any(Function), expect.any(Object)
    ))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
  })

  it.each([
    [{ ParseError: 'PDF parsing failed unexpectedly: unhandled function type 4' }, 'pdfUnsupportedFeature'],
    [{ ParseError: 'PDF parse error: invalid start value in xref table' }, 'pdfMalformedXref'],
    [{ ParseError: 'PDF appears to be image-based or scanned' }, 'pdfScanned'],
    [{ ParseError: 'PDF is encrypted, password required' }, 'pdfEncrypted'],
    [{ UnsupportedFileType: 'odt' }, 'unsupportedType'],
    [{ IoError: 'disk gone' }, 'ioError'],
    [{ ParseError: 'totally weird failure' }, 'parseGeneric'],
  ])(
    'maps RagError %j to uploadFailed.%s',
    async (ragError, key) => {
      dialogOpenMock.mockResolvedValue(['/docs/report.pdf'])
      ingestMock.mockImplementation(async (_pid, _atts, _fn, opts) => {
        opts.onError(ragError, 'report.pdf')
      })
      await clickUpload()
      await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
      expect(lastErrorDescription()).toBe(`common:toast.uploadFailed.${key}`)
    }
  )

  it('warns and skips unsupported file extensions without ingesting', async () => {
    dialogOpenMock.mockResolvedValue(['/docs/archive.zzz'])
    await clickUpload()
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled())
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('rejects files exceeding the max size without ingesting', async () => {
    fileStatMock.mockResolvedValue({ isDirectory: false, size: 50 * 1024 * 1024 })
    dialogOpenMock.mockResolvedValue(['/docs/huge.pdf'])
    await clickUpload()
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'common:errors.fileTooLarge',
        expect.any(Object)
      )
    )
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('skips duplicates already attached to the project', async () => {
    listAttachmentsForProjectMock.mockResolvedValue([
      { id: 'd1', name: 'report.pdf', path: '/docs/report.pdf', chunk_count: 1 },
    ])
    dialogOpenMock.mockResolvedValue(['/docs/report.pdf'])
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getAllByText('report.pdf').length).toBeGreaterThan(0)
    )
    fireEvent.click(screen.getByText('common:projects.processButton'))
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled())
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('renders the upload progress bar while an ingest is in flight', async () => {
    uploadsHoisted.progress = { p1: { current: 1, total: 3 } }
    render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.uploadingFiles')).toBeInTheDocument()
    )
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByTestId('progress')).toHaveAttribute('data-value', String((1 / 3) * 100))
  })

  it('ingests files dropped with Tauri paths via dataTransfer.items', async () => {
    ingestMock.mockImplementation(async (_pid, atts, _fn, opts) => {
      expect(atts[0]).toMatchObject({ path: '/dropped/a.pdf', fileType: 'pdf' })
      opts.onSuccess()
    })
    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
    const dropzone = container.querySelector('.border-dashed') as HTMLElement
    const file = Object.assign(new File(['x'], 'a.pdf'), { path: '/dropped/a.pdf' })
    fireEvent.drop(dropzone, {
      dataTransfer: {
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [],
      },
    })
    await waitFor(() => expect(ingestMock).toHaveBeenCalled())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
  })

  it('falls back to dataTransfer.files when items are unavailable', async () => {
    ingestMock.mockImplementation(async (_pid, atts, _fn, opts) => {
      expect(atts[0]).toMatchObject({ path: '/web/b.pdf' })
      opts.onSuccess()
    })
    const { container } = render(<ProjectFiles projectId="p1" lng="en" />)
    await waitFor(() =>
      expect(screen.getByText('common:projects.filesDescription')).toBeInTheDocument()
    )
    const dropzone = container.querySelector('.border-dashed') as HTMLElement
    const file = Object.assign(new File(['x'], 'b.pdf'), { path: '/web/b.pdf' })
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(ingestMock).toHaveBeenCalled())
  })

  it('recursively gathers supported files from a dropped directory', async () => {
    fileStatMock.mockImplementation(async (p: string) => ({
      isDirectory: p === '/dir',
      size: 100,
    }))
    readdirSyncMock.mockResolvedValue(['/dir/a.pdf', '/dir/skip.bin'])
    dialogOpenMock.mockResolvedValue(['/dir'])
    ingestMock.mockImplementation(async (_pid, atts, _fn, opts) => {
      // only the supported .pdf survives the SUPPORTED_EXTENSIONS filter
      expect(atts.map((a: { path: string }) => a.path)).toEqual(['/dir/a.pdf'])
      opts.onSuccess()
    })
    await clickUpload()
    await waitFor(() => expect(ingestMock).toHaveBeenCalled())
  })
})
