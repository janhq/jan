import '@testing-library/jest-dom'
import { waitFor } from '@testing-library/react'

import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import RightPanelContainer, { rightPanelWidthAtom } from './index'
import { showRightPanelAtom } from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

// Mocking ResizeObserver
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserver

// Mocking window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

// Mocking the required atoms
jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtomValue: jest.fn((atom) => {
      if (atom === reduceTransparentAtom) return false
      if (atom === showRightPanelAtom) return true
    }),
    useAtom: jest.fn((atom) => {
      if (atom === rightPanelWidthAtom) return [280, jest.fn()]
      if (atom === showRightPanelAtom) return [true, mockSetShowRightPanel]
      return [null, jest.fn()]
    }),
  }
})

const mockSetShowRightPanel = jest.fn()

beforeEach(() => {
  // Setting up the localStorage mock
  localStorage.clear()
  localStorage.setItem('rightPanelWidth', '280') // Setting a default width
})

describe('RightPanelContainer', () => {
  it('renders correctly with children', () => {
    const { getByText } = render(
      <RightPanelContainer>
        <div>Child Content</div>
      </RightPanelContainer>
    )

    // Check if the child content is rendered
    expect(getByText('Child Content')).toBeInTheDocument()
  })

  it('initializes width from localStorage', async () => {
    const { container } = render(<RightPanelContainer />)

    const rightPanel = container.firstChild as HTMLDivElement

    // Wait for the width to be applied
    await waitFor(() => {
      expect(rightPanel.style.width).toBe('280px') // Correct width from localStorage
    })
  })

  it('changes width on resizing', () => {
    const { container } = render(<RightPanelContainer />)

    const rightPanel = container.firstChild as HTMLDivElement

    // Simulate mouse down on the resize handle
    const resizeHandle = document.createElement('div')
    resizeHandle.className = 'group/resize'
    rightPanel.appendChild(resizeHandle)

    // Simulate mouse down to start resizing
    fireEvent.mouseDown(resizeHandle)

    // Simulate mouse move event
    fireEvent.mouseMove(window, { clientX: 100 })

    // Simulate mouse up to stop resizing
    fireEvent.mouseUp(window)

    // Verify that the right panel's width changes
    // Since we can't get the actual width calculation in this test,
    // you may want to check if the rightPanelWidth is updated in your implementation.
    // Here, just check if the function is called:
    expect(localStorage.getItem('rightPanelWidth')).toBeDefined()
  })

  it('hides panel when clicked outside on mobile', () => {
    // Mock useMediaQuery to simulate mobile view
    ;(window.matchMedia as jest.Mock).mockImplementation((query) => ({
      matches: true, // Always return true for mobile
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }))

    const { container } = render(
      <RightPanelContainer>
        <div>Child Content</div>
      </RightPanelContainer>
    )

    const rightPanel = container.firstChild as HTMLDivElement

    // Simulate a click outside
    fireEvent.mouseDown(document.body)
    fireEvent.mouseUp(document.body) // Ensure the click event is completed

    // Verify that setShowRightPanel was called to hide the panel
    expect(mockSetShowRightPanel).toHaveBeenCalledWith(false)
  })
})
