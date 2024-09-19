import React from 'react'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TextArea } from './index'

jest.mock('./styles.scss', () => ({}))

describe('@joi/core/TextArea', () => {
  it('renders correctly', () => {
    render(<TextArea placeholder="Enter text here" />)
    const textareaElement = screen.getByPlaceholderText('Enter text here')
    expect(textareaElement).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<TextArea className="custom-class" />)
    const textareaElement = screen.getByRole('textbox')
    expect(textareaElement).toHaveClass('textarea')
    expect(textareaElement).toHaveClass('custom-class')
  })

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLTextAreaElement>()
    render(<TextArea ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
  })

  it('passes through additional props', () => {
    render(<TextArea data-testid="custom-textarea" rows={5} />)
    const textareaElement = screen.getByTestId('custom-textarea')
    expect(textareaElement).toHaveAttribute('rows', '5')
  })

  it('should auto resize the textarea based on minResize', () => {
    render(<TextArea autoResize minResize={10} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    Object.defineProperty(textarea, 'scrollHeight', {
      value: 20,
      writable: true,
    })

    act(() => {
      textarea.value = 'Short text'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(textarea.style.height).toBe('10px')
  })

  it('should auto resize the textarea based on maxResize', () => {
    render(<TextArea autoResize maxResize={40} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    Object.defineProperty(textarea, 'scrollHeight', {
      value: 100,
      writable: true,
    })

    act(() => {
      textarea.value = 'A very long text that should exceed max height'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(textarea.style.height).toBe('40px')
  })
})
