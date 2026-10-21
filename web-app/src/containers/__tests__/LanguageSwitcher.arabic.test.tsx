import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import LanguageSwitcher from '../LanguageSwitcher'
import { TranslationProvider } from '@/i18n/TranslationContext'
import i18n from '@/i18n/setup'
import { localStorageKey } from '@/constants/localStorage'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const settings = vi.hoisted(() => ({ currentLanguage: 'en', setCurrentLanguage: vi.fn() }))
vi.mock('@/hooks/useGeneralSetting', () => ({ useGeneralSetting: () => settings }))
afterEach(() => {
  cleanup()
  i18n.changeLanguage('en')
  localStorage.clear()
  settings.currentLanguage = 'en'
  vi.clearAllMocks()
})

it('interpolates Arabic count labels without imposing English noun forms', () => {
  i18n.changeLanguage('ar')
  for (const count of [0, 1, 2, 3, 11, 102]) {
    expect(i18n.t('htmlArtifact.unresolvedAssets', { count })).toContain(String(count))
    expect(i18n.t('htmlArtifact.unresolvedAssets', { count })).not.toContain('{{')
  }
})

it('selects Arabic, persists ar and restores LTR when switching back to English', async () => {
  const user = userEvent.setup()
  const view = render(<TranslationProvider><LanguageSwitcher /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'English' }))
  await user.click(await screen.findByRole('menuitem', { name: 'العربية' }))
  expect(settings.setCurrentLanguage).toHaveBeenCalledWith('ar')
  expect(i18n.t('common:close')).toBe('إغلاق')
  expect(document.documentElement).toHaveAttribute('lang', 'ar')
  expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)).toMatchObject({ state: { currentLanguage: 'ar' } })
  settings.currentLanguage = 'ar'
  view.rerender(<TranslationProvider><LanguageSwitcher /></TranslationProvider>)
  await user.click(screen.getByRole('button', { name: 'العربية' }))
  expect(screen.getByRole('menu')).toHaveAttribute('dir', 'rtl')
  await user.click(screen.getByRole('menuitem', { name: 'English' }))
  settings.currentLanguage = 'en'
  view.rerender(<TranslationProvider><LanguageSwitcher /></TranslationProvider>)
  await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'ltr'))
  expect(document.documentElement).toHaveAttribute('lang', 'en')
  await user.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByRole('menu')).toHaveAttribute('dir', 'ltr')
})

it('restores Arabic document metadata from the saved language on initialization', async () => {
  localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'ar' } }))
  vi.resetModules()
  const fresh = (await import('@/i18n/setup')).default
  expect(fresh.language).toBe('ar')
  expect(document.documentElement).toHaveAttribute('lang', 'ar')
  expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  fresh.changeLanguage('fr')
  expect(document.documentElement).toHaveAttribute('dir', 'ltr')
})

it('keeps technical input types LTR and free text automatic, while allowing explicit direction', () => {
  render(<div dir="rtl">
    <Input aria-label="url" type="url" value="https://example.invalid/v1" readOnly />
    <Input aria-label="number" type="number" value="-12" readOnly />
    <Input aria-label="name" value="اسم المشروع" readOnly />
    <Textarea aria-label="instructions" value="تعليمات المساعد" readOnly />
    <Input aria-label="override" dir="ltr" />
  </div>)
  expect(screen.getByLabelText('url')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByLabelText('number')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByLabelText('name')).toHaveAttribute('dir', 'auto')
  expect(screen.getByLabelText('instructions')).toHaveAttribute('dir', 'auto')
  expect(screen.getByLabelText('override')).toHaveAttribute('dir', 'ltr')
})
