import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    activeTheme: 'dark',
    setTheme: vi.fn(),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { ThemeSwitcher } from '../ThemeSwitcher'

describe('ThemeSwitcher', () => {
  it('renders dropdown with current theme', () => {
    render(<ThemeSwitcher />)
    expect(screen.getByText('common:dark')).toBeDefined()
  })

  it('renders radio variant', () => {
    render(<ThemeSwitcher renderAsRadio />)
    expect(screen.getByText('common:dark')).toBeDefined()
    expect(screen.getByText('common:light')).toBeDefined()
    expect(screen.getByText('common:system')).toBeDefined()
  })
})
