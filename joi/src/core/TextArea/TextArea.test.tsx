import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
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
})
