import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { CopyButton } from '../CopyButton'

// Preserve original clipboard so this suite does not leak to other tests.
const originalClipboard = navigator.clipboard

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    writable: true,
    configurable: true,
  })
  vi.clearAllMocks()
})

describe('CopyButton', () => {
  it('renders copy button', () => {
    render(<CopyButton text="hello" />)
    expect(screen.getByRole('button')).toBeDefined()
  })

  it('copies text to clipboard on click', () => {
    render(<CopyButton text="hello" />)
    fireEvent.click(screen.getByRole('button'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
  })
})
