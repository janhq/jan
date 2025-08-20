import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { ModelCombobox } from '../ModelCombobox'
import React from 'react'

describe('ModelCombobox', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    models: ['gpt-3.5-turbo', 'gpt-4', 'claude-3-haiku'],
  }

  const mockUser = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Rendering', () => {
    it('should render input field with placeholder', () => {
      render(<ModelCombobox {...defaultProps} />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder', 'Type or select a model...')
    })

    it('should render custom placeholder', () => {
      render(<ModelCombobox {...defaultProps} placeholder="Choose a model" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'Choose a model')
    })

    it('should render dropdown trigger button', () => {
      render(<ModelCombobox {...defaultProps} />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should display current value in input', () => {
      render(<ModelCombobox {...defaultProps} value="gpt-4" />)

      const input = screen.getByDisplayValue('gpt-4')
      expect(input).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(
        <ModelCombobox {...defaultProps} className="custom-class" />
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  describe('Disabled State', () => {
    it('should disable input when disabled prop is true', () => {
      render(<ModelCombobox {...defaultProps} disabled />)

      const input = screen.getByRole('textbox')
      const button = screen.getByRole('button')

      expect(input).toBeDisabled()
      expect(button).toBeDisabled()
    })

    it('should not open dropdown when disabled', async () => {
      render(<ModelCombobox {...defaultProps} disabled />)

      const input = screen.getByRole('textbox')
      await mockUser.click(input)

      expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should show loading spinner in trigger button', () => {
      render(<ModelCombobox {...defaultProps} loading />)

      const button = screen.getByRole('button')
      const spinner = button.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('should show loading spinner when loading prop is true', () => {
      render(<ModelCombobox {...defaultProps} loading />)

      const spinner = screen.getByRole('button').querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Input Interactions', () => {
    it('should call onChange when typing', async () => {
      const mockOnChange = vi.fn()
      render(<ModelCombobox {...defaultProps} onChange={mockOnChange} />)

      const input = screen.getByRole('textbox')
      await mockUser.type(input, 'g')

      expect(mockOnChange).toHaveBeenCalledWith('g')
    })

    it('should update input value when typing', async () => {
      const mockOnChange = vi.fn()
      render(<ModelCombobox {...defaultProps} onChange={mockOnChange} />)

      const input = screen.getByRole('textbox')
      await mockUser.type(input, 'test')

      expect(input).toHaveValue('test')
    })

    it('should handle input focus', async () => {
      render(<ModelCombobox {...defaultProps} />)

      const input = screen.getByRole('textbox')
      await mockUser.click(input)

      expect(input).toHaveFocus()
    })
  })

  describe('Props Validation', () => {
    it('should render with empty models array', () => {
      render(<ModelCombobox {...defaultProps} models={[]} />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should render with models array', () => {
      render(<ModelCombobox {...defaultProps} models={['model1', 'model2']} />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should render with all props', () => {
      render(
        <ModelCombobox
          {...defaultProps}
          loading
          error="Error message"
          onRefresh={vi.fn()}
          placeholder="Custom placeholder"
          disabled
        />
      )

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toBeDisabled()
    })
  })

  describe('Component Lifecycle', () => {
    it('should handle mount and unmount without errors', () => {
      const { unmount } = render(<ModelCombobox {...defaultProps} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()

      unmount()

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should handle props changes', () => {
      const { rerender } = render(<ModelCombobox {...defaultProps} value="" />)

      expect(screen.getByDisplayValue('')).toBeInTheDocument()

      rerender(<ModelCombobox {...defaultProps} value="gpt-4" />)

      expect(screen.getByDisplayValue('gpt-4')).toBeInTheDocument()
    })

    it('should handle models array changes', () => {
      const { rerender } = render(<ModelCombobox {...defaultProps} models={[]} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()

      rerender(<ModelCombobox {...defaultProps} models={['model1', 'model2']} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })
})
