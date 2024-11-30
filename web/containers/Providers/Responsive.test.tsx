import '@testing-library/jest-dom'
import React from 'react'
import { render } from '@testing-library/react'
import { useAtom } from 'jotai'
import Responsive from './Responsive'
import { showLeftPanelAtom, showRightPanelAtom } from '@/helpers/atoms/App.atom'

// Mocking the required atoms
jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtom: jest.fn(),
    useAtomValue: jest.fn(),
  }
})

const mockSetShowLeftPanel = jest.fn()
const mockSetShowRightPanel = jest.fn()
const mockShowLeftPanel = true
const mockShowRightPanel = true

beforeEach(() => {
  // Mocking the atom behavior
  ;(useAtom as jest.Mock).mockImplementation((atom) => {
    if (atom === showLeftPanelAtom) {
      return [mockShowLeftPanel, mockSetShowLeftPanel]
    }
    if (atom === showRightPanelAtom) {
      return [mockShowRightPanel, mockSetShowRightPanel]
    }
    return [null, jest.fn()]
  })
})

describe('Responsive', () => {
  beforeAll(() => {
    // Mocking the window.matchMedia function
    window.matchMedia = jest.fn().mockImplementation((query) => {
      return {
        matches: false, // Set this to true to simulate mobile view
        addListener: jest.fn(),
        removeListener: jest.fn(),
      }
    })
  })

  it('hides left and right panels on small screens', () => {
    // Simulate mobile view
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: true, // Change to true to simulate mobile
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }))

    render(<Responsive />)

    // Check that the left and right panel states were updated to false
    expect(mockSetShowLeftPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowRightPanel).toHaveBeenCalledWith(false)
  })

  it('restores the last known panel states on larger screens', () => {
    // Simulate mobile view first
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: true, // Change to true to simulate mobile
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }))

    render(<Responsive />)

    // Change back to desktop view
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: false, // Change to false to simulate desktop
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }))

    // Call the effect manually to simulate the component re-rendering
    const rerender = render(<Responsive />)

    // Check that the last known states were restored (which were true initially)
    expect(mockSetShowLeftPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowRightPanel).toHaveBeenCalledWith(true)
  })
})
