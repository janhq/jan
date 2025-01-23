import { render, screen, fireEvent } from '@testing-library/react'
import { useAtom } from 'jotai'
import '@testing-library/jest-dom'
import CopyOverInstruction from './index'

// Mock the `useAtom` hook from jotai
jest.mock('jotai', () => ({
  useAtom: jest.fn(),
  atom: jest.fn(),
}))

describe('CopyOverInstruction', () => {
  const setCopyOverInstructionEnabled = jest.fn()

  beforeEach(() => {
    ;(useAtom as jest.Mock).mockImplementation(() => [
      false,
      setCopyOverInstructionEnabled,
    ])
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should render the component with the switch in the correct state', () => {
    render(<CopyOverInstruction />)

    // Assert the text is rendered
    expect(
      screen.getByText(/Save instructions for new threads/i)
    ).toBeInTheDocument()

    // Assert the switch is rendered and in the unchecked state
    const switchInput = screen.getByRole('checkbox')
    expect(switchInput).toBeInTheDocument()
    expect(switchInput).not.toBeChecked()
  })

  it('should call setCopyOverInstructionEnabled when the switch is toggled', () => {
    render(<CopyOverInstruction />)

    const switchInput = screen.getByRole('checkbox')

    // Simulate toggling the switch
    fireEvent.click(switchInput)

    // Assert that the atom setter is called with true when checked
    expect(setCopyOverInstructionEnabled).toHaveBeenCalledWith(true)
  })

  it('should reflect the updated state when the atom value changes', () => {
    // Mock the atom to return true (enabled state)
    ;(useAtom as jest.Mock).mockImplementation(() => [
      true,
      setCopyOverInstructionEnabled,
    ])

    render(<CopyOverInstruction />)

    const switchInput = screen.getByRole('checkbox')

    // The switch should now be checked
    expect(switchInput).toBeChecked()
  })
})
