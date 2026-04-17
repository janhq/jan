import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteProjectDialog } from '../DeleteProjectDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (opts) return `${key}:${JSON.stringify(opts)}`
      return key
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockDeleteFolderWithThreads = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: (s: { threads: Record<string, Thread> }) => unknown) =>
    selector({ threads: {} }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    deleteFolderWithThreads: mockDeleteFolderWithThreads,
  }),
}))

describe('DeleteProjectDialog', () => {
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog when open', () => {
    render(
      <DeleteProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        projectId="proj-1"
        projectName="My Project"
      />
    )
    expect(screen.getByText('projects.deleteProjectDialog.title')).toBeInTheDocument()
  })

  it('shows empty project description when no threads', () => {
    render(
      <DeleteProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        projectId="proj-1"
        projectName="My Project"
      />
    )
    expect(screen.getByText(/projects.deleteProjectDialog.deleteEmptyProject/)).toBeInTheDocument()
  })

  it('calls deleteFolderWithThreads on confirm', async () => {
    render(
      <DeleteProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        projectId="proj-1"
        projectName="My Project"
      />
    )
    fireEvent.click(screen.getByText('projects.deleteProjectDialog.deleteButton'))
    await waitFor(() => {
      expect(mockDeleteFolderWithThreads).toHaveBeenCalledWith('proj-1')
    })
  })

  it('does not delete when projectId is missing', async () => {
    render(
      <DeleteProjectDialog
        open={true}
        onOpenChange={onOpenChange}
      />
    )
    fireEvent.click(screen.getByText('projects.deleteProjectDialog.deleteButton'))
    expect(mockDeleteFolderWithThreads).not.toHaveBeenCalled()
  })

  it('shows cancel button', () => {
    render(
      <DeleteProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        projectId="proj-1"
      />
    )
    expect(screen.getByText('cancel')).toBeInTheDocument()
  })
})
