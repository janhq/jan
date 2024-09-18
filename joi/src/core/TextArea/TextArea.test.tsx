import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { act } from 'react-dom/test-utils'
import { TextArea } from './index'

// Mock the styles import
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

  it('resizes correctly based scrollHeight', () => {
    const { container } = render(<TextArea autoResize />)
    const textareaElement = container.querySelector('textarea')

    // Mocking the scrollHeight
    act(() => {
      if (textareaElement) {
        Object.defineProperty(textareaElement, 'scrollHeight', {
          value: 80,
          writable: false,
        })
        textareaElement.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    expect(textareaElement.scrollHeight).toBe(80)
  })

  it('resizes correctly based on min height', () => {
    const { container } = render(<TextArea autoResize minResize={100} />)
    const textareaElement = container.querySelector('textarea')

    // Mocking the scrollHeight
    act(() => {
      if (textareaElement) {
        Object.defineProperty(textareaElement, 'scrollHeight', {
          value: 100,
          writable: false,
        })
        textareaElement.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    expect(textareaElement.scrollHeight).toBe(100)
  })

  it('resizes correctly based on max height', () => {
    const { container } = render(<TextArea autoResize maxResize={400} />)
    const textareaElement = container.querySelector('textarea')

    // Mocking the scrollHeight
    act(() => {
      if (textareaElement) {
        Object.defineProperty(textareaElement, 'scrollHeight', {
          value: 400,
          writable: false,
        })
        textareaElement.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    expect(textareaElement.scrollHeight).toBe(400)
  })
})
