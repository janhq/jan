import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockSetFontSize = vi.fn()
vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: () => ({
    fontSize: '16px',
    setFontSize: mockSetFontSize,
  }),
  fontSizeOptions: [
    { label: 'Small', value: '14px' },
    { label: 'Medium', value: '16px' },
  ],
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { FontSizeSwitcher } from '../FontSizeSwitcher'

describe('FontSizeSwitcher', () => {
  it('renders dropdown with current label', () => {
    render(<FontSizeSwitcher />)
    expect(screen.getByText('Medium')).toBeDefined()
  })

  it('renders radio variant', () => {
    render(<FontSizeSwitcher renderAsRadio />)
    expect(screen.getByText('Small')).toBeDefined()
    expect(screen.getByText('Medium')).toBeDefined()
  })
})
