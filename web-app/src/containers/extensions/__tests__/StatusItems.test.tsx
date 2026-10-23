import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExtensionHost } from '@/lib/extensions/host'
import { StatusItems } from '../StatusItems'
import { createTestHost } from './harness'

const hostRef = vi.hoisted(() => ({ current: undefined as unknown }))
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/extensions/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/host')>()),
  getExtensionHost: () => hostRef.current,
}))
vi.mock('@/i18n/react-i18next-compat', async () => {
  const i18n = (await import('@/i18n/setup')).default
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})
vi.mock('sonner', () => ({ toast: { error: toastError } }))
// The footer reads the sidebar context; only its layout matters here.
vi.mock('@/components/ui/sidebar', () => ({
  SidebarFooter: (props: React.ComponentProps<'div'>) => <div {...props} />,
}))

let host: ExtensionHost
let activate: ReturnType<typeof createTestHost>['activate']

beforeEach(() => {
  const test = createTestHost()
  host = test.host
  activate = test.activate
  hostRef.current = host
  toastError.mockReset()
})

afterEach(async () => {
  await act(() => host.deactivateAll())
})

describe('StatusItems', () => {
  it('renders nothing without status items', () => {
    const { container } = render(<StatusItems />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels each item with its extension, highest priority first, and hides them after dispose', async () => {
    await act(() =>
      activate('acme.status', 'Acme Status', {
        statusItems: [
          { id: 'low', text: 'Low', priority: 1 },
          { id: 'high', text: 'High', tooltip: 'Very high', priority: 5 },
        ],
      })
    )
    render(<StatusItems />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['High', 'Low'])
    expect(buttons[0]).toHaveAccessibleName('Very high - Acme Status')
    expect(buttons[1]).toHaveAccessibleName('Low - Acme Status')

    await act(() => host.deactivateAll())
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reflects setStatusItem updates', async () => {
    await act(() =>
      activate('acme.status', 'Acme Status', {
        statusItems: [{ id: 'sync', text: 'Idle' }],
      })
    )
    render(<StatusItems />)
    act(() =>
      host.contributions.setStatusItem('acme.status', 'sync', {
        text: 'Syncing',
      })
    )
    expect(screen.getByRole('button')).toHaveTextContent('Syncing')
  })

  it('runs its command on click and toasts a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = vi.fn(() => {
      throw new Error('offline')
    })
    await act(() =>
      activate(
        'acme.status',
        'Acme Status',
        {
          commands: [{ id: 'sync', title: 'Sync now' }],
          statusItems: [{ id: 'sync', text: 'Idle', command: 'sync' }],
        },
        { sync: handler }
      )
    )
    render(<StatusItems />)
    await userEvent.click(screen.getByRole('button', { name: /Idle/ }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Sync now (Acme Status) failed', {
        description: 'offline',
      })
    )
    expect(handler).toHaveBeenCalledWith({ location: 'statusItem' })
  })
})
