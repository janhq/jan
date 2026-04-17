import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/components/ui/progress', () => ({ Progress: () => <div data-testid="progress" /> }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: (_lng?: string) => ({ t: (k: string) => k }) }))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('lucide-react', () => ({
  FileText: () => <span />, Trash2: () => <span />, UploadIcon: () => <span />,
}))
vi.mock('@tabler/icons-react', () => ({
  IconLoader2: () => <span data-testid="loader" />, IconPaperclip: () => <span />,
}))
vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: { VectorDB: 'VectorDB' },
  VectorDBExtension: {},
  FileStat: {},
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))
vi.mock('@/types/attachment', () => ({
  createDocumentAttachment: vi.fn((a: any) => a),
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: (sel?: any) => {
    const state = { enabled: true, maxFileSizeMB: 10 }
    return sel ? sel(state) : state
  },
}))

import ProjectFiles from '../ProjectFiles'

describe('ProjectFiles', () => {
  it('renders upload button', async () => {
    render(<ProjectFiles projectId="proj-1" lng="en" />)
    expect(screen.getByText('Upload')).toBeInTheDocument()
  })

  it('renders files header', () => {
    render(<ProjectFiles projectId="proj-1" lng="en" />)
    expect(screen.getByText('common:projects.files')).toBeInTheDocument()
  })
})
