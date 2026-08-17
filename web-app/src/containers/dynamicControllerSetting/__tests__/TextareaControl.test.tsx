import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextareaControl } from '../TextareaControl'

describe('TextareaControl', () => {
  it('does not disable manual resize, so long content (e.g. Jinja templates) can be expanded into view', () => {
    render(
      <TextareaControl
        value="{% for message in messages %}...{% endfor %}"
        onChange={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    // `resize-none` combined with a fixed row count truncates long
    // custom Jinja chat templates on webviews that don't support
    // `field-sizing: content` (see issue #8672). The control must allow
    // the user to grow the box instead of hard-locking its size.
    expect(textarea).not.toHaveClass('resize-none')
    expect(textarea).toHaveClass('resize-y')
  })

  it('caps growth with a scrollable max height instead of growing unbounded', () => {
    render(<TextareaControl value="long template" onChange={vi.fn()} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass('max-h-[420px]')
    expect(textarea).toHaveClass('overflow-y-auto')
  })

  it('respects a custom rows value passed by the caller', () => {
    render(<TextareaControl value="" onChange={vi.fn()} rows={10} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('rows', '10')
  })
})
