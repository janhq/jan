import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LanguageSwitcher from '../LanguageSwitcher'

const changeLanguage = vi.fn()
const setCurrentLanguage = vi.fn()

vi.mock('@/i18n', () => ({
  useAppTranslation: () => ({
    i18n: { changeLanguage },
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({ currentLanguage: 'en', setCurrentLanguage }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}))

vi.mock('@/lib/utils', () => ({ cn: (...classes: string[]) => classes.filter(Boolean).join(' ') }))

describe('LanguageSwitcher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers Swedish and changes to the Swedish locale', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher />)

    await user.click(screen.getByRole('button', { name: 'Svenska' }))

    expect(changeLanguage).toHaveBeenCalledWith('sv')
    expect(setCurrentLanguage).toHaveBeenCalledWith('sv')
  })
})
