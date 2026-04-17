import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetApiKey = vi.fn()
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    apiKey: 'test-key',
    setApiKey: mockSetApiKey,
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { ApiKeyInput } from '../ApiKeyInput'

describe('ApiKeyInput', () => {
  it('renders password input', () => {
    render(<ApiKeyInput />)
    const input = screen.getByPlaceholderText('common:enterApiKey')
    expect(input).toBeDefined()
    expect(input).toHaveAttribute('type', 'password')
  })

  it('toggles password visibility', () => {
    render(<ApiKeyInput />)
    const toggleBtn = screen.getByRole('button')
    const input = screen.getByPlaceholderText('common:enterApiKey')
    fireEvent.click(toggleBtn)
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(toggleBtn)
    expect(input).toHaveAttribute('type', 'password')
  })

  it('calls setApiKey on blur', () => {
    render(<ApiKeyInput />)
    const input = screen.getByPlaceholderText('common:enterApiKey')
    fireEvent.change(input, { target: { value: 'new-key' } })
    fireEvent.blur(input)
    expect(mockSetApiKey).toHaveBeenCalledWith('new-key')
  })

  it('shows error when showError and empty', () => {
    render(<ApiKeyInput showError />)
    const input = screen.getByPlaceholderText('common:enterApiKey')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(screen.getByText('common:apiKeyRequired')).toBeDefined()
  })
})
