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

it('selects 粵語 by its native label and persists yue', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: '粵語' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('yue')
  expect(i18n.language).toBe('yue')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'yue' } })
  settings.currentLanguage = 'yue'
  view.rerender(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('我今日可以點樣幫你？'))
  expect(screen.getByRole('button', { name: '粵語' })).toBeInTheDocument()
})

it('refreshes visible copy when settings restore yue after English initialization and when switching back', async () => {
  settings.currentLanguage = 'yue'
  const view = render(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('我今日可以點樣幫你？'))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('How can I help you today?'))
})

it('restores the saved yue preference on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'yue' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('yue')
  expect(fresh.t('chat:welcome')).toBe('你好，你好嗎？')
  fresh.changeLanguage('en')
})

it('preserves interpolation in tool approvals and count messages', () => {
  i18n.changeLanguage('yue')
  expect(i18n.t('tools:toolApproval.allowServerAlways', { server: 'fixture-server' })).toBe('一律允許 fixture-server')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    const result = i18n.t('subagentsRunning', { count })
    expect(result).toBe(`運作中嘅子代理數目：${count}`)
  }
})
