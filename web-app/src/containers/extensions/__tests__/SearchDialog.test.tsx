import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExtensionHost } from '@/lib/extensions/host'
import { SearchDialog } from '@/containers/dialogs/SearchDialog'
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

let host: ExtensionHost
let activate: ReturnType<typeof createTestHost>['activate']

beforeEach(() => {
  const test = createTestHost()
  host = test.host
  activate = test.activate
  hostRef.current = host
})

afterEach(async () => {
  await act(() => host.deactivateAll())
})

const contributes = {
  commands: [
    { id: 'hello', title: 'Say hello', category: 'Greeter' },
    { id: 'bye', title: 'Say bye' },
  ],
  menus: { commandPalette: [{ command: 'hello' }, { command: 'bye' }] },
}

describe('SearchDialog commands', () => {
  it('lists palette commands with their extension and hides them after dispose', async () => {
    await act(() => activate('acme.greeter', 'Acme Greeter', contributes))
    render(<SearchDialog open onOpenChange={() => undefined} />)
    expect(screen.getByText('Commands')).toBeInTheDocument()
    const hello = screen.getByRole('button', { name: /Greeter: Say hello/ })
    expect(hello).toHaveTextContent('Acme Greeter')
    expect(screen.getByRole('button', { name: /Say bye/ })).toBeInTheDocument()

    await act(() => host.deactivateAll())
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('filters commands by the query and runs the chosen one', async () => {
    const hello = vi.fn()
    const onOpenChange = vi.fn()
    await act(() =>
      activate('acme.greeter', 'Acme Greeter', contributes, { hello })
    )
    render(<SearchDialog open onOpenChange={onOpenChange} />)
    await userEvent.type(screen.getByRole('textbox'), 'hello')
    expect(screen.queryByRole('button', { name: /Say bye/ })).toBeNull()
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(hello).toHaveBeenCalledWith({ location: 'commandPalette' })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
