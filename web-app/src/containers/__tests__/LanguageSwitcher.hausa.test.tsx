import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import LanguageSwitcher from '../LanguageSwitcher'
import { TranslationProvider } from '@/i18n/TranslationContext'
import { useAppTranslation } from '@/i18n/hooks'
import i18n from '@/i18n/setup'
import { localStorageKey } from '@/constants/localStorage'

const settings = vi.hoisted(() => ({ currentLanguage: 'en', setCurrentLanguage: vi.fn() }))
vi.mock('@/hooks/useGeneralSetting', () => ({ useGeneralSetting: () => settings }))

function Label() {
  const { t } = useAppTranslation()
  return <span data-testid="translated-label">{t('chat:description')}</span>
}

afterEach(() => {
  cleanup()
  i18n.changeLanguage('en')
  localStorage.clear()
  settings.currentLanguage = 'en'
  vi.clearAllMocks()
})

it('selects Hausa by its native label and persists ha', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Hausa' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('ha')
  expect(i18n.language).toBe('ha')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'ha' } })
  settings.currentLanguage = 'ha'
  view.rerender(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('Ta yaya zan iya taimaka muku yau?'))
  expect(screen.getByRole('button', { name: 'Hausa' })).toBeInTheDocument()
})

it('refreshes visible copy when settings restore ha after English initialization and when switching back', async () => {
  settings.currentLanguage = 'ha'
  const view = render(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('Ta yaya zan iya taimaka muku yau?'))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('How can I help you today?'))
})

it('restores the saved ha preference on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'ha' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('ha')
  expect(fresh.t('chat:welcome')).toBe('Sannu, ya kuke?')
  fresh.changeLanguage('en')
})

it('preserves interpolation in tool approvals and count messages', () => {
  i18n.changeLanguage('ha')
  expect(i18n.t('tools:toolApproval.allowServerAlways', { server: 'fixture-server' })).toBe('Ba da izini ga fixture-server koyaushe')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    const result = i18n.t('subagentsRunning', { count })
    expect(result).toBe(`Ƙananan mataimaka masu aiki: ${count}`)
  }
})
