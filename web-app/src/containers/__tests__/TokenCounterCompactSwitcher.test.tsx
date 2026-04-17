import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockSetTokenCounterCompact = vi.fn()
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    tokenCounterCompact: false,
    setTokenCounterCompact: mockSetTokenCounterCompact,
  }),
}))

import { TokenCounterCompactSwitcher } from '../TokenCounterCompactSwitcher'

describe('TokenCounterCompactSwitcher', () => {
  it('renders switch', () => {
    render(<TokenCounterCompactSwitcher />)
    expect(screen.getByRole('switch')).toBeDefined()
  })
})
