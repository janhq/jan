import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tabler/icons-react', () => ({ IconSettings: () => <span data-testid="icon-settings" /> }))
vi.mock('lodash.debounce', () => ({ default: (fn: any) => fn }))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: any) => <div data-testid="sheet">{children}</div>,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetDescription: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <div data-testid="sheet-title">{children}</div>,
  SheetTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: () => <div data-testid="dynamic-controller" />,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.modelId ? `Settings: ${opts.modelId}` : k }) }))
vi.mock('@/lib/utils', () => ({
  cn: (...a: any[]) => a.filter(Boolean).join(' '),
  getModelDisplayName: (m: any) => m.displayName || m.id,
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({ updateProvider: vi.fn() }),
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: (sel?: any) => {
    const state = { setActiveModels: vi.fn() }
    return sel ? sel(state) : state
  },
}))

import { ModelSetting } from '../ModelSetting'

describe('ModelSetting', () => {
  const mockProvider = { provider: 'llamacpp', models: [{ id: 'model-1', settings: {} }] } as any
  const mockModel = { id: 'model-1', displayName: 'Test Model', settings: {} } as any

  it('renders sheet with settings icon', () => {
    render(<ModelSetting provider={mockProvider} model={mockModel} />)
    expect(screen.getByTestId('sheet')).toBeInTheDocument()
    expect(screen.getByTestId('icon-settings')).toBeInTheDocument()
  })

  it('renders model name in sheet title', () => {
    render(<ModelSetting provider={mockProvider} model={mockModel} />)
    expect(screen.getByText('Settings: Test Model')).toBeInTheDocument()
  })
})
