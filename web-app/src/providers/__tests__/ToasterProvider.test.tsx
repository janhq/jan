import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToasterProvider } from '../ToasterProvider'

vi.mock('@/components/ui/sonner', () => ({
  Toaster: (props: any) => <div data-testid="toaster" data-position={props.position} />,
}))

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: vi.fn((selector?: any) => {
    const state = { notificationPosition: 'bottom-right' as const }
    if (selector) return selector(state)
    return state
  }),
}))

vi.mock('@/utils/toastPlacement', () => ({
  getToastOffset: vi.fn(() => '16px'),
}))

describe('ToasterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Toaster component', () => {
    const { getByTestId } = render(<ToasterProvider />)
    expect(getByTestId('toaster')).toBeInTheDocument()
  })

  it('passes notification position to Toaster', () => {
    const { getByTestId } = render(<ToasterProvider />)
    expect(getByTestId('toaster')).toHaveAttribute('data-position', 'bottom-right')
  })
})
