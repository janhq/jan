import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import LanguageSwitcher from '../LanguageSwitcher'
import { TranslationProvider } from '@/i18n/TranslationContext'
import i18n from '@/i18n/setup'
import { localStorageKey } from '@/constants/localStorage'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAppTranslation } from '@/i18n/hooks'

const settings = vi.hoisted(() => ({ currentLanguage: 'en', setCurrentLanguage: vi.fn() }))
vi.mock('@/hooks/useGeneralSetting', () => ({ useGeneralSetting: () => settings }))
afterEach(() => {
  cleanup()
  i18n.changeLanguage('en')
  localStorage.clear()
  settings.currentLanguage = 'en'
  vi.clearAllMocks()
})

it('refreshes visible translations when the settings store restores Iranian Persian after initialization', async () => {
  function Label() {
    const { t } = useAppTranslation()
    return <span data-testid="translated-label">{t('common:settings')}</span>
  }
  settings.currentLanguage = 'fa-IR'
  const view = render(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('تنظیمات'))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><Label /></TranslationProvider>)
  await waitFor(() => expect(screen.getByTestId('translated-label')).toHaveTextContent('Settings'))
})

it('interpolates Iranian Persian count labels without imposing English noun forms', () => {
  i18n.changeLanguage('fa-IR')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    expect(i18n.t('htmlArtifact.unresolvedAssets', { count })).toContain(String(count))
    expect(i18n.t('htmlArtifact.unresolvedAssets', { count })).not.toContain('{{')
  }
})

it('selects Iranian Persian, persists fa-IR and restores LTR when switching back to English', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: 'فارسی (ایران)' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('fa-IR')
  expect(i18n.t('common:close')).toBe('بستن')
  expect(document.documentElement).toHaveAttribute('lang', 'fa-IR')
  expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'fa-IR' } })
  settings.currentLanguage = 'fa-IR'
  view.rerender(<TranslationProvider><LanguageSwitcher /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'فارسی (ایران)' }))
  expect(screen.getByRole('menu')).toHaveAttribute('dir', 'rtl')
  await user.click(screen.getByRole('menuitem', { name: 'English' }))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><LanguageSwitcher /></TranslationProvider>)
  await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'ltr'))
  expect(document.documentElement).toHaveAttribute('lang', 'en')
  await user.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByRole('menu')).toHaveAttribute('dir', 'ltr')
})

it('restores Iranian Persian document metadata from the saved language on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'fa-IR' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('fa-IR')
  expect(document.documentElement).toHaveAttribute('lang', 'fa-IR')
  expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  fresh.changeLanguage('fr')
  expect(document.documentElement).toHaveAttribute('dir', 'ltr')
})

it('keeps technical input types LTR and free text automatic, while allowing explicit direction', () => {
  render(<div dir="rtl">
    <Input aria-label="url" type="url" value="https://example.invalid/v1" readOnly />
    <Input aria-label="number" type="number" value="-12" readOnly />
    <Input aria-label="name" value="نام پروژه" readOnly />
    <Textarea aria-label="instructions" value="دستورالعمل‌های دستیار" readOnly />
    <Input aria-label="override" dir="ltr" />
  </div>)
  expect(screen.getByLabelText('url')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByLabelText('number')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByLabelText('name')).toHaveAttribute('dir', 'auto')
  expect(screen.getByLabelText('instructions')).toHaveAttribute('dir', 'auto')
  expect(screen.getByLabelText('override')).toHaveAttribute('dir', 'ltr')
})
