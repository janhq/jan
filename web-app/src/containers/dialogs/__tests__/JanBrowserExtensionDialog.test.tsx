import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import JanBrowserExtensionDialog from '../JanBrowserExtensionDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => false,
}))

vi.mock('@tabler/icons-react', () => ({
  IconExternalLink: () => <span data-testid="external-link" />,
  IconLoader2: () => <span data-testid="loader" />,
}))

vi.mock('@radix-ui/react-visually-hidden', () => ({
  VisuallyHidden: ({ children }: any) => <span>{children}</span>,
}))

describe('JanBrowserExtensionDialog', () => {
  const onOpenChange = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders checking state with spinner', () => {
    render(
      <JanBrowserExtensionDialog
        open={true}
        onOpenChange={onOpenChange}
        state="checking"
      />
    )
    expect(screen.getAllByText('mcp-servers:browserExtension.connecting.checking').length).toBeGreaterThan(0)
  })

  it('renders not_installed state with install button', () => {
    render(
      <JanBrowserExtensionDialog
        open={true}
        onOpenChange={onOpenChange}
        state="not_installed"
      />
    )
    expect(screen.getByText('mcp-servers:browserExtension.notInstalled.title')).toBeInTheDocument()
    expect(screen.getByText('mcp-servers:browserExtension.notInstalled.getExtension')).toBeInTheDocument()
  })

  it('calls onCancel when cancel clicked', () => {
    const onCancel = vi.fn()
    render(
      <JanBrowserExtensionDialog
        open={true}
        onOpenChange={onOpenChange}
        state="not_installed"
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByText('common:cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders nothing for closed state', () => {
    const { container } = render(
      <JanBrowserExtensionDialog
        open={true}
        onOpenChange={onOpenChange}
        state="closed"
      />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
