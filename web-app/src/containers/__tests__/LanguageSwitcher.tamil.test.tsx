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

it('selects Tamil by its native label and persists ta', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: 'தமிழ்' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('ta')
  expect(i18n.language).toBe('ta')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'ta' } })
  settings.currentLanguage = 'ta'
  view.rerender(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('இன்று உங்களுக்கு எப்படி உதவலாம்?'))
  expect(screen.getByRole('button', { name: 'தமிழ்' })).toBeInTheDocument()
})

it('refreshes visible copy when settings restore ta after English initialization and when switching back', async () => {
  settings.currentLanguage = 'ta'
  const view = render(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('இன்று உங்களுக்கு எப்படி உதவலாம்?'))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('How can I help you today?'))
})

it('restores the saved ta preference on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'ta' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('ta')
  expect(fresh.t('chat:welcome')).toBe('வணக்கம், எப்படி இருக்கிறீர்கள்?')
  fresh.changeLanguage('en')
})

it('preserves interpolation in tool approvals and count messages', () => {
  i18n.changeLanguage('ta')
  expect(i18n.t('tools:toolApproval.allowServerAlways', { server: 'fixture-server' })).toBe('fixture-server ஐ எப்போதும் அனுமதிக்கவும்')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    const result = i18n.t('subagentsRunning', { count })
    expect(result).toBe(`இயங்கும் துணை உதவியாளர்கள்: ${count}`)
  }
})
