import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import { AddProviderDialog } from '../AddProviderDialog'

describe('AddProviderDialog', () => {
  const onCreateProvider = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger child', () => {
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>Add Provider</button>
      </AddProviderDialog>
    )
    expect(screen.getByText('Add Provider')).toBeInTheDocument()
  })

  it('opens dialog when trigger is clicked', () => {
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>Add Provider</button>
      </AddProviderDialog>
    )
    fireEvent.click(screen.getByText('Add Provider'))
    expect(screen.getByText('provider:addOpenAIProvider')).toBeInTheDocument()
  })

  it('has a disabled create button when name is empty', () => {
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>Add Provider</button>
      </AddProviderDialog>
    )
    fireEvent.click(screen.getByText('Add Provider'))
    const createBtn = screen.getByRole('button', { name: 'common:create' })
    expect(createBtn).toBeDisabled()
  })

  it('enables create button when name is typed', () => {
    render(
      <AddProviderDialog onCreateProvider={onCreateProvider}>
        <button>Add Provider</button>
      </AddProviderDialog>
    )
    fireEvent.click(screen.getByText('Add Provider'))
    const input = screen.getByPlaceholderText('provider:enterNameForProvider')
    fireEvent.change(input, { target: { value: 'My Provider' } })
    const createBtn = screen.getByRole('button', { name: 'common:create' })
    expect(createBtn).not.toBeDisabled()
  })
})
