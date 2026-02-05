import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { ModelCombobox } from '../ModelCombobox'

// Mock translation hook
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'common:failedToLoadModels') return 'Failed to load models'
      if (key === 'common:loading') return 'Loading'
      if (key === 'common:noModelsFoundFor')
        return `No models found for "${options?.searchValue}"`
      if (key === 'common:noModels') return 'No models available'
      return key
    },
  }),
}))

describe('ModelCombobox', () => {
  const mockOnChange = vi.fn()
  const mockOnRefresh = vi.fn()

  const defaultProps = {
    value: '',
    onChange: mockOnChange,
    models: ['gpt-3.5-turbo', 'gpt-4', 'claude-3-haiku'],
  }

  let bcrSpy: ReturnType<typeof vi.spyOn>
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeAll(() => {
    const mockRect = {
      width: 300,
      height: 40,
      top: 100,
      left: 50,
      bottom: 140,
      right: 350,
      x: 50,
      y: 100,
      toJSON: () => {},
    } as unknown as DOMRect

    bcrSpy = vi
      .spyOn(Element.prototype as any, 'getBoundingClientRect')
      .mockReturnValue(mockRect)

    Element.prototype.scrollIntoView = () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    bcrSpy?.mockRestore()
    scrollSpy?.mockRestore()
  })

  it('renders input field with default placeholder', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} />)
    })

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Type or select a model...')
  })

  it('renders custom placeholder', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} placeholder="Choose a model" />)
    })

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'Choose a model')
  })

  it('renders dropdown trigger button', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} />)
    })

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('displays current value in input', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} value="gpt-4" />)
    })

    const input = screen.getByDisplayValue('gpt-4')
    expect(input).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <ModelCombobox {...defaultProps} className="custom-class" />
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('custom-class')
  })

  it('disables input when disabled prop is true', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} disabled />)
    })

    const input = screen.getByRole('textbox')
    const button = screen.getByRole('button')

    expect(input).toBeDisabled()
    expect(button).toBeDisabled()
  })

  it('shows loading section when dropdown is opened during loading', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} loading />)

    // Click input to trigger dropdown opening
    const input = screen.getByRole('textbox')
    await user.click(input)

    // Wait for dropdown to appear and check loading section
    await waitFor(() => {
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
      expect(screen.getByText('Loading')).toBeInTheDocument()
    })
  })

  it('calls onChange when typing', async () => {
    const user = userEvent.setup()
    const localMockOnChange = vi.fn()
    render(<ModelCombobox {...defaultProps} onChange={localMockOnChange} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'g')

    expect(localMockOnChange).toHaveBeenCalledWith('g')
  })

  it('updates input value when typing', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'test')

    expect(input).toHaveValue('test')
  })

  it('handles input focus', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.click(input)

    expect(input).toHaveFocus()
  })

  it('renders with empty models array', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} models={[]} />)
    })

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
  })

  it('renders with models array', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} models={['model1', 'model2']} />)
    })

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
  })

  it('handles mount and unmount without errors', () => {
    const { unmount } = render(<ModelCombobox {...defaultProps} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()

    unmount()

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('handles props changes', () => {
    const { rerender } = render(<ModelCombobox {...defaultProps} value="" />)

    expect(screen.getByDisplayValue('')).toBeInTheDocument()

    rerender(<ModelCombobox {...defaultProps} value="gpt-4" />)

    expect(screen.getByDisplayValue('gpt-4')).toBeInTheDocument()
  })

  it('handles models array changes', () => {
    const { rerender } = render(<ModelCombobox {...defaultProps} models={[]} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()

    rerender(<ModelCombobox {...defaultProps} models={['model1', 'model2']} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('does not open dropdown when clicking input with no models', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} models={[]} />)

    const input = screen.getByRole('textbox')
    await user.click(input)

    // Should focus but not open dropdown
    expect(input).toHaveFocus()
    const dropdown = document.querySelector('[data-dropdown="model-combobox"]')
    expect(dropdown).not.toBeInTheDocument()
  })

  it('accepts error prop without crashing', () => {
    act(() => {
      render(<ModelCombobox {...defaultProps} error="Test error message" />)
    })

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Type or select a model...')
  })

  it('renders with all props', () => {
    act(() => {
      render(
        <ModelCombobox
          {...defaultProps}
          loading
          error="Error message"
          onRefresh={mockOnRefresh}
          placeholder="Custom placeholder"
          disabled
        />
      )
    })

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
    expect(input).toBeDisabled()
  })

  it('opens dropdown when clicking trigger button', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
    })
  })

  it('opens dropdown when clicking input', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.click(input)

    expect(input).toHaveFocus()
    await waitFor(() => {
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
    })
  })

  it('filters models based on input value', async () => {
    const user = userEvent.setup()
    const localMockOnChange = vi.fn()
    render(<ModelCombobox {...defaultProps} onChange={localMockOnChange} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'gpt-4')

    expect(localMockOnChange).toHaveBeenCalledWith('gpt-4')
  })

  it('shows filtered models in dropdown when typing', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    // Type 'gpt' to trigger dropdown opening
    await user.type(input, 'gpt')

    await waitFor(() => {
      // Dropdown should be open
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()

      // Should show GPT models
      expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument()
      expect(screen.getByText('gpt-4')).toBeInTheDocument()
      // Should not show Claude
      expect(screen.queryByText('claude-3-haiku')).not.toBeInTheDocument()
    })
  })

  it('handles case insensitive filtering', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'GPT')

    expect(mockOnChange).toHaveBeenCalledWith('GPT')
  })

  it('shows empty state when no models match filter', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    // Type something that doesn't match any model to trigger dropdown + empty state
    await user.type(input, 'nonexistent')

    await waitFor(() => {
      // Dropdown should be open
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
      // Should show empty state message
      expect(
        screen.getByText('No models found for "nonexistent"')
      ).toBeInTheDocument()
    })
  })

  it('selects model from dropdown when clicked', async () => {
    const user = userEvent.setup()
    const localMockOnChange = vi.fn()
    render(<ModelCombobox {...defaultProps} onChange={localMockOnChange} />)

    const input = screen.getByRole('textbox')
    await user.click(input)

    await waitFor(() => {
      const modelOption = screen.getByText('gpt-4')
      expect(modelOption).toBeInTheDocument()
    })

    const modelOption = screen.getByText('gpt-4')
    await user.click(modelOption)

    expect(localMockOnChange).toHaveBeenCalledWith('gpt-4')
    expect(input).toHaveValue('gpt-4')
  })

  it('submits input value with Enter key', async () => {
    const user = userEvent.setup()
    const localMockOnChange = vi.fn()
    render(<ModelCombobox {...defaultProps} onChange={localMockOnChange} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'gpt')
    await user.keyboard('{Enter}')

    expect(localMockOnChange).toHaveBeenCalledWith('gpt')
  })

  it('displays error message in dropdown', async () => {
    const user = userEvent.setup()
    render(
      <ModelCombobox {...defaultProps} error="Network connection failed" />
    )

    const input = screen.getByRole('textbox')
    // Click input to open dropdown
    await user.click(input)

    await waitFor(() => {
      // Dropdown should be open
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
      // Error messages should be displayed
      expect(screen.getByText('Failed to load models')).toBeInTheDocument()
      expect(screen.getByText('Network connection failed')).toBeInTheDocument()
    })
  })

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup()
    const localMockOnRefresh = vi.fn()
    render(
      <ModelCombobox
        {...defaultProps}
        error="Network error"
        onRefresh={localMockOnRefresh}
      />
    )

    const input = screen.getByRole('textbox')
    // Click input to open dropdown
    await user.click(input)

    await waitFor(() => {
      // Dropdown should be open with error section
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
      const refreshButton = document.querySelector(
        '[aria-label="Refresh models"]'
      )
      expect(refreshButton).toBeInTheDocument()
    })

    const refreshButton = document.querySelector(
      '[aria-label="Refresh models"]'
    )
    if (refreshButton) {
      await user.click(refreshButton)
      expect(localMockOnRefresh).toHaveBeenCalledTimes(1)
    }
  })

  it('opens dropdown when pressing ArrowDown', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    input.focus()
    await user.keyboard('{ArrowDown}')

    expect(input).toHaveFocus()
    await waitFor(() => {
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
    })
  })

  it('navigates through models with arrow keys', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox {...defaultProps} />)

    const input = screen.getByRole('textbox')
    input.focus()

    // ArrowDown should open dropdown
    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      // Dropdown should be open
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
    })

    // Navigate to second item
    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      const secondModel = screen.getByText('gpt-4')
      const modelElement = secondModel.closest('[data-model]')
      expect(modelElement).toHaveClass('bg-main-view-fg/20')
    })
  })

  it('handles Enter key to select highlighted model', async () => {
    const user = userEvent.setup()
    const localMockOnChange = vi.fn()
    render(<ModelCombobox {...defaultProps} onChange={localMockOnChange} />)

    const input = screen.getByRole('textbox')
    // Type 'gpt' to open dropdown and filter models
    await user.type(input, 'gpt')

    await waitFor(() => {
      // Dropdown should be open with filtered models
      const dropdown = document.querySelector(
        '[data-dropdown="model-combobox"]'
      )
      expect(dropdown).toBeInTheDocument()
    })

    // Navigate to highlight first model and select it
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(localMockOnChange).toHaveBeenCalledWith('gpt-3.5-turbo')
  })
})
