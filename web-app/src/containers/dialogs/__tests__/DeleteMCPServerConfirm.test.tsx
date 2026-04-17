import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DeleteMCPServerConfirm from '../DeleteMCPServerConfirm'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('DeleteMCPServerConfirm', () => {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders dialog when open', () => {
    render(
      <DeleteMCPServerConfirm
        open={true}
        onOpenChange={onOpenChange}
        serverName="test-server"
        onConfirm={onConfirm}
      />
    )
    expect(screen.getByText('mcp-servers:deleteServer.title')).toBeInTheDocument()
    expect(screen.getByText('mcp-servers:deleteServer.description')).toBeInTheDocument()
  })

  it('calls onConfirm and closes on delete click', () => {
    render(
      <DeleteMCPServerConfirm
        open={true}
        onOpenChange={onOpenChange}
        serverName="test-server"
        onConfirm={onConfirm}
      />
    )
    fireEvent.click(screen.getByText('mcp-servers:deleteServer.delete'))
    expect(onConfirm).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on cancel click', () => {
    render(
      <DeleteMCPServerConfirm
        open={true}
        onOpenChange={onOpenChange}
        serverName="test-server"
        onConfirm={onConfirm}
      />
    )
    fireEvent.click(screen.getByText('common:cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not render when closed', () => {
    const { container } = render(
      <DeleteMCPServerConfirm
        open={false}
        onOpenChange={onOpenChange}
        serverName="test-server"
        onConfirm={onConfirm}
      />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
