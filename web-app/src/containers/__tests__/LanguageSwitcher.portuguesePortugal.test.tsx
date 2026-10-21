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

function VariantLabel() {
  const { t } = useAppTranslation()
  return <span data-testid="variant-label">{t('common:settings')} / {t('common:save')}</span>
}

afterEach(() => {
  cleanup()
  i18n.changeLanguage('en')
  localStorage.clear()
  settings.currentLanguage = 'en'
  vi.clearAllMocks()
})

it('selects Português (Portugal) by its native label and persists pt-PT', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Português (Portugal)' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('pt-PT')
  expect(i18n.language).toBe('pt-PT')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'pt-PT' } })
  settings.currentLanguage = 'pt-PT'
  view.rerender(<TranslationProvider><LanguageSwitcher /><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('Como posso ajudar hoje?'))
  expect(screen.getByRole('button', { name: 'Português (Portugal)' })).toBeInTheDocument()
})

it('refreshes visible copy when settings restore pt-PT after English initialization and when switching back', async () => {
  settings.currentLanguage = 'pt-PT'
  const view = render(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('Como posso ajudar hoje?'))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('How can I help you today?'))
})

it('restores the saved pt-PT preference on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'pt-PT' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('pt-PT')
  expect(fresh.t('chat:welcome')).toBe('Olá, como está?')
  fresh.changeLanguage('en')
})

it('preserves interpolation in tool approvals and count messages', () => {
  i18n.changeLanguage('pt-PT')
  expect(i18n.t('tools:toolApproval.allowServerAlways', { server: 'fixture-server' })).toBe('Permitir sempre fixture-server')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    const result = i18n.t('subagentsRunning', { count })
    expect(result).toBe(`Subagentes em execução: ${count}`)
  }
})

it('switches independently between Portugal and Brazil and saves each exact locale', async () => {
  const user = userEvent.setup()
  settings.currentLanguage = 'pt-PT'
  const view = render(<TranslationProvider><LanguageSwitcher /><VariantLabel /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('variant-label')).toHaveTextContent('Definições / Guardar'))
  await user.click(screen.getByRole('button', { name: 'Português (Portugal)' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Português (Brasil)' }))
  expect(settings.setCurrentLanguage).toHaveBeenLastCalledWith('pt-BR')
  expect(i18n.language).toBe('pt-BR')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'pt-BR' } })
  settings.currentLanguage = 'pt-BR'
  view.rerender(<TranslationProvider><LanguageSwitcher /><VariantLabel /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('variant-label')).toHaveTextContent('Configurações / Salvar'))
  await user.click(screen.getByRole('button', { name: 'Português (Brasil)' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Português (Portugal)' }))
  expect(settings.setCurrentLanguage).toHaveBeenLastCalledWith('pt-PT')
  expect(i18n.language).toBe('pt-PT')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'pt-PT' } })
  settings.currentLanguage = 'pt-PT'
  view.rerender(<TranslationProvider><LanguageSwitcher /><VariantLabel /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('variant-label')).toHaveTextContent('Definições / Guardar'))
})

it('keeps an existing saved Brazil preference when Portugal is available', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'pt-BR' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('pt-BR')
  expect(fresh.t('common:settings')).toBe('Configurações')
  expect(fresh.t('common:save')).toBe('Salvar')
  fresh.changeLanguage('en')
})
