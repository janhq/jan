import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeleteAssistantDialog } from '../DeleteAssistantDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('DeleteAssistantDialog', () => {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog when open', () => {
    render(
      <DeleteAssistantDialog open={true} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    )
    expect(screen.getByText('assistants:deleteConfirmation')).toBeInTheDocument()
    expect(screen.getByText('assistants:deleteConfirmationDesc')).toBeInTheDocument()
  })

  it('does not render content when closed', () => {
    render(
      <DeleteAssistantDialog open={false} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    )
    expect(screen.queryByText('assistants:deleteConfirmation')).not.toBeInTheDocument()
  })

  it('calls onConfirm when delete button clicked', () => {
    render(
      <DeleteAssistantDialog open={true} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'assistants:delete' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onOpenChange(false) when cancel clicked', () => {
    render(
      <DeleteAssistantDialog open={true} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    )
    fireEvent.click(screen.getByText('assistants:cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls onConfirm on Enter keydown', () => {
    render(
      <DeleteAssistantDialog open={true} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'assistants:delete' }), { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalled()
  })
})
