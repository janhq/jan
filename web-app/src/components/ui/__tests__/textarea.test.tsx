import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Textarea } from '../textarea'

describe('Textarea', () => {
  it('renders textarea element', () => {
    render(<Textarea />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeInTheDocument()
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('renders with placeholder', () => {
    render(<Textarea placeholder="Enter your message..." />)
    
    const textarea = screen.getByPlaceholderText('Enter your message...')
    expect(textarea).toBeInTheDocument()
  })

  it('renders with value', () => {
    render(<Textarea value="test content" readOnly />)
    
    const textarea = screen.getByDisplayValue('test content')
    expect(textarea).toBeInTheDocument()
  })

  it('handles onChange events', () => {
    const handleChange = vi.fn()
    render(<Textarea onChange={handleChange} />)
    
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'new content' } })
    
    expect(handleChange).toHaveBeenCalledTimes(1)
  })

  it('renders with disabled state', () => {
    render(<Textarea disabled />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeDisabled()
  })

  it('renders with custom className', () => {
    render(<Textarea className="custom-textarea" />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass('custom-textarea')
  })

  it('renders with default styling classes', () => {
    render(<Textarea />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass('flex')
    expect(textarea).toHaveClass('min-h-16')
    expect(textarea).toHaveClass('w-full')
    expect(textarea).toHaveClass('rounded-md')
    expect(textarea).toHaveClass('border')
  })

  it('forwards ref correctly', () => {
    const ref = { current: null }
    render(<Textarea ref={ref} />)
    
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
  })

  it('handles focus and blur events', () => {
    const handleFocus = vi.fn()
    const handleBlur = vi.fn()
    render(<Textarea onFocus={handleFocus} onBlur={handleBlur} />)
    
    const textarea = screen.getByRole('textbox')
    
    fireEvent.focus(textarea)
    expect(handleFocus).toHaveBeenCalledTimes(1)
    
    fireEvent.blur(textarea)
    expect(handleBlur).toHaveBeenCalledTimes(1)
  })

  it('handles key events', () => {
    const handleKeyDown = vi.fn()
    render(<Textarea onKeyDown={handleKeyDown} />)
    
    const textarea = screen.getByRole('textbox')
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
    
    expect(handleKeyDown).toHaveBeenCalledTimes(1)
  })

  it('handles multiline text', () => {
    const multilineText = 'Line 1\nLine 2\nLine 3'
    render(<Textarea value={multilineText} readOnly />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue(multilineText)
    expect(textarea).toBeInTheDocument()
  })

  it('renders with custom rows', () => {
    render(<Textarea rows={5} />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('rows', '5')
  })

  it('renders with custom cols', () => {
    render(<Textarea cols={50} />)
    
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('cols', '50')
  })
})
