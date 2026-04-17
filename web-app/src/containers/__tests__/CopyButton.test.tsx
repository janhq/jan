import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

import { CopyButton } from '../CopyButton'

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
