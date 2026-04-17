import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/dropdrawer', () => ({
  DropDrawer: ({ children }: any) => <div data-testid="dropdrawer">{children}</div>,
  DropDrawerContent: ({ children }: any) => <div>{children}</div>,
  DropDrawerItem: ({ children, disabled }: any) => <div data-testid="dropdrawer-item" data-disabled={disabled}>{children}</div>,
  DropDrawerSub: ({ children }: any) => <div>{children}</div>,
  DropDrawerLabel: ({ children }: any) => <div>{children}</div>,
  DropDrawerSubContent: ({ children }: any) => <div>{children}</div>,
  DropDrawerSeparator: () => <hr />,
  DropDrawerSubTrigger: ({ children }: any) => <div>{children}</div>,
  DropDrawerTrigger: ({ children }: any) => <div>{children}</div>,
  DropDrawerGroup: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked }: any) => <input type="checkbox" data-testid="switch" checked={checked} readOnly />,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (sel?: any) => {
    const state = { tools: [] }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({ getCurrentThread: () => ({ id: 'thread-1' }) }),
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: () => ({
    isToolDisabled: vi.fn().mockReturnValue(false),
    setToolDisabledForThread: vi.fn(),
    setDefaultDisabledTools: vi.fn(),
    initializeThreadTools: vi.fn(),
    getDisabledToolsForThread: vi.fn().mockReturnValue([]),
    getDefaultDisabledTools: vi.fn().mockReturnValue([]),
  }),
}))

import DropdownToolsAvailable from '../DropdownToolsAvailable'

describe('DropdownToolsAvailable', () => {
  it('renders no tools available when empty', () => {
    render(
      <DropdownToolsAvailable>
        {(isOpen, count) => <button>Tools ({count})</button>}
      </DropdownToolsAvailable>
    )
    expect(screen.getByText('common:noToolsAvailable')).toBeInTheDocument()
  })

  it('renders trigger with count', () => {
    render(
      <DropdownToolsAvailable>
        {(isOpen, count) => <button>Tools ({count})</button>}
      </DropdownToolsAvailable>
    )
    expect(screen.getByText('Tools (0)')).toBeInTheDocument()
  })
})
