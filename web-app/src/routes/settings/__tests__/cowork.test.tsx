import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const h = vi.hoisted(() => ({ invoke: vi.fn(), toastError: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config }),
}))
vi.mock('@/constants/routes', () => ({
  route: { settings: { cowork: '/settings/cowork', general: '/settings/general' } },
}))
vi.mock('@/lib/coworkAccess', () => ({ ensureCoworkEnabled: () => undefined }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {header}
      {children}
    </div>
  ),
  CardItem: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
    <div data-testid={`row-${title}`}>
      {title}
      {actions}
    </div>
  ),
}))
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <input type="checkbox" role="switch" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn(), info: vi.fn() } }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }),
}))
vi.mock('@/lib/agentTools', () => ({
  getSandboxStatus: async () => ({ enforces: true, backend: 'seatbelt' }),
}))
vi.mock('@/lib/agentWorkspace', () => ({
  storePath: async () => '/data/store',
  revealStore: vi.fn(),
  listSkills: async () => [],
  readSkill: vi.fn(),
  writeSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listMemories: async () => [],
  readMemory: vi.fn(),
  writeMemory: vi.fn(),
  deleteMemory: vi.fn(),
}))

import { Route } from '../cowork'
import { DEFAULT_CHAT_PERMISSIONS, useChatPermissions } from '@/hooks/useChatPermissions'

const renderScreen = () => {
  const Component = (Route as any).component as React.ComponentType
  return render(<Component />)
}
const networkSwitch = async () =>
  (await screen.findByTestId('row-settings:cowork.network')).querySelector('input') as HTMLInputElement
const memorySwitch = async () =>
  (await screen.findByTestId('row-settings:cowork.memoryWrite')).querySelector('input') as HTMLInputElement

describe('Settings: chat permissions', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    h.toastError.mockReset()
    useChatPermissions.setState({ ...DEFAULT_CHAT_PERMISSIONS })
  })

  it('offers network and memory writes, both on by default', async () => {
    renderScreen()
    expect(await networkSwitch()).toBeChecked()
    expect(await memorySwitch()).toBeChecked()
  })

  it('saves each switch through the host, one field at a time', async () => {
    h.invoke.mockImplementation(async (cmd: string, args: any) =>
      cmd === 'get_chat_permissions' ? { ...DEFAULT_CHAT_PERMISSIONS } : args.value
    )
    renderScreen()
    fireEvent.click(await memorySwitch())
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith('set_chat_permissions', {
        value: { shellNetwork: true, memoryWrite: false },
      })
    )
    await waitFor(() => expect(useChatPermissions.getState().memoryWrite).toBe(false))
    expect(useChatPermissions.getState().shellNetwork).toBe(true)
  })

  it('leaves the switch where it was and says so when the host refuses', async () => {
    h.invoke.mockRejectedValue(new Error('disk full'))
    renderScreen()
    fireEvent.click(await networkSwitch())
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith('settings:cowork.permissionSaveFailed')
    )
    expect(useChatPermissions.getState().shellNetwork).toBe(true)
    expect(await networkSwitch()).toBeChecked()
  })
})
