import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockChangeLanguage = vi.fn()
vi.mock('@/i18n', () => ({
  useAppTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: mockChangeLanguage },
  }),
}))
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    currentLanguage: 'en',
    setCurrentLanguage: vi.fn(),
  }),
}))

import LanguageSwitcher from '../LanguageSwitcher'

describe('LanguageSwitcher', () => {
  it('renders with English selected', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByText('English')).toBeDefined()
  })
})
