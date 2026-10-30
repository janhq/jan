import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { SettingContribution } from '@janhq/extension-api'
import type { ExtensionHost } from '@/lib/extensions/host'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useContributions } from '@/lib/extensions/contributions'
import { listExtensionProviders } from '@/lib/extensions/providers'
import { SearchDialog } from '@/containers/dialogs/SearchDialog'
import { ExtensionSettingsForm } from '../ExtensionSettingsForm'
import { StatusItems } from '../StatusItems'
import { createTestHost } from './harness'

const hostRef = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@/lib/extensions/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/host')>()),
  getExtensionHost: () => hostRef.current,
}))
vi.mock('@/i18n/react-i18next-compat', async () => {
  const i18n = (await import('@/i18n/setup')).default
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarFooter: (props: React.ComponentProps<'div'>) => <div {...props} />,
}))

const l10n = {
  en: {
    name: 'Greeter',
    'greet.title': 'Say hello',
    'greet.category': 'Greetings',
    'status.text': 'Ready',
    'status.tooltip': 'Greeter is ready',
    'setting.title': 'Greeting',
    'setting.description': 'What to say',
    'provider.name': 'Greeter Cloud',
    'setting.hint': 'Type a greeting',
  },
  ja: {
    name: 'Aisatsu',
    'greet.title': 'Konnichiwa',
    'greet.category': 'Aisatsu-rui',
    'status.text': 'Junbi OK',
    'setting.title': 'Aisatsu no kotoba',
    'setting.hint': 'Aisatsu wo nyuryoku',
  },
}

const contributes = {
  commands: [
    { id: 'greet', title: '%greet.title%', category: '%greet.category%' },
  ],
  menus: { commandPalette: [{ command: 'greet' }] },
  statusItems: [
    { id: 'status', text: '%status.text%', tooltip: '%status.tooltip%' },
  ],
  settings: [
    {
      key: 'greeting',
      title: '%setting.title%',
      description: '%setting.description%',
      control: {
        type: 'input' as const,
        placeholder: '%setting.hint%',
        default: '',
      },
    },
  ],
}

let host: ExtensionHost
let activate: ReturnType<typeof createTestHost>['activate']

const setLanguage = (language: Language) =>
  act(() => useGeneralSetting.getState().setCurrentLanguage(language))

const NO_SETTINGS: SettingContribution[] = []

function Surfaces() {
  const settings = useContributions(
    (s) => s.settings['acme.greeter'] ?? NO_SETTINGS
  )
  return (
    <>
      <SearchDialog open onOpenChange={() => undefined} />
      <StatusItems />
      <ExtensionSettingsForm extensionId="acme.greeter" settings={settings} />
    </>
  )
}

beforeEach(async () => {
  const test = createTestHost()
  host = test.host
  activate = test.activate
  hostRef.current = host
  await act(() => activate('acme.greeter', '%name%', contributes, {}, l10n))
})

afterEach(async () => {
  setLanguage('en')
  await act(() => host.deactivateAll())
})

describe('manifest l10n', () => {
  it('renders %key% strings in the app language and follows a switch', () => {
    render(<Surfaces />)
    expect(
      screen.getByRole('button', { name: /Greetings: Say hello/ })
    ).toHaveTextContent('Greeter')
    // The open palette is modal and hides its siblings from the a11y tree.
    expect(screen.getByLabelText('Extension: Greeter - Greeter is ready')).toHaveTextContent('Ready')
    expect(screen.getByText('Greeting')).toBeInTheDocument()
    expect(screen.getByText('What to say')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type a greeting')).toBeInTheDocument()

    setLanguage('ja')
    expect(
      screen.getByRole('button', { name: /Aisatsu-rui: Konnichiwa/ })
    ).toHaveTextContent('Aisatsu')
    // `status.tooltip` has no ja entry, so it falls back to en.
    expect(
      screen.getByLabelText('Extension: Aisatsu - Greeter is ready')
    ).toHaveTextContent('Junbi OK')
    expect(screen.getByText('Aisatsu no kotoba')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Aisatsu wo nyuryoku')).toBeInTheDocument()
    expect(screen.getByText('What to say')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('drops the tables when the extension unloads', async () => {
    render(<StatusItems />)
    expect(useContributions.getState().extensions['acme.greeter'].l10n).toEqual(
      l10n
    )
    await act(() => host.deactivateAll())
    expect(useContributions.getState().extensions).not.toHaveProperty(
      'acme.greeter'
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('provider l10n', () => {
  it('names a contributed provider and its extension in the app language', async () => {
    await act(() =>
      activate(
        'acme.cloud',
        '%name%',
        {
          providers: [
            {
              id: 'cloud',
              displayName: '%provider.name%',
              baseUrl: 'https://api.acme.dev/v1',
            },
          ],
        },
        {},
        l10n
      )
    )
    host.contributions.registerProvider('acme.cloud', 'cloud', {})
    setLanguage('ja')
    const [provider] = listExtensionProviders(useContributions.getState())
    expect(provider.extensionName).toBe('Aisatsu')
    // No ja entry: en.
    expect(provider.contribution.displayName).toBe('Greeter Cloud')
  })
})
