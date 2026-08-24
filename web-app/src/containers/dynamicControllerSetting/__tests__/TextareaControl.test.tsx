import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TextareaControl } from '../TextareaControl'

const LONG_TEMPLATE =
  '{% for message in messages %}{{ message.role }}{% endfor %}'.repeat(500)

describe('TextareaControl', () => {
  it('renders a textarea with the provided value', () => {
    render(
      <TextareaControl value="hello" onChange={() => {}} placeholder="tmpl" />
    )
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue('hello')
    expect(textarea).toHaveAttribute('placeholder', 'tmpl')
  })

  it('forwards onChange events', () => {
    const handleChange = vi.fn()
    render(<TextareaControl value="" onChange={handleChange} />)
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'new' },
    })
    expect(handleChange).toHaveBeenCalledWith('new')
  })

  it('caps the height so long template content scrolls instead of truncating', () => {
    render(<TextareaControl value={LONG_TEMPLATE} onChange={() => {}} />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass('max-h-64')
    expect(textarea).toHaveClass('overflow-y-auto')
    expect(textarea).toHaveValue(LONG_TEMPLATE)
  })
})
