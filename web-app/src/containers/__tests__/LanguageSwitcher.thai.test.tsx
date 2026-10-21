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

it('selects ไทย by its native label and persists th', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: 'ไทย' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('th')
  expect(i18n.language).toBe('th')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'th' } })
  settings.currentLanguage = 'th'
  view.rerender(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('วันนี้มีอะไรให้ช่วยบ้าง?'))
  expect(screen.getByRole('button', { name: 'ไทย' })).toBeInTheDocument()
})

it('refreshes visible copy when settings restore th after English initialization and when switching back', async () => {
  settings.currentLanguage = 'th'
  const view = render(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('วันนี้มีอะไรให้ช่วยบ้าง?'))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('How can I help you today?'))
})

it('restores the saved th preference on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'th' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('th')
  expect(fresh.t('chat:welcome')).toBe('สวัสดี เป็นอย่างไรบ้าง?')
  fresh.changeLanguage('en')
})

it('preserves interpolation in tool approvals and count messages', () => {
  i18n.changeLanguage('th')
  expect(i18n.t('tools:toolApproval.allowServerAlways', { server: 'fixture-server' })).toBe('อนุญาต fixture-server เสมอ')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    const result = i18n.t('subagentsRunning', { count })
    expect(result).toBe(`จำนวนเอเจนต์ย่อยที่กำลังทำงาน: ${count}`)
  }
})
