import { render, screen } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import CenterPanelContainer from './index'
import '@testing-library/jest-dom'

// Mock useAtomValue from jotai
jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useAtomValue: jest.fn(),
}))

describe('CenterPanelContainer', () => {
  it('renders with reduceTransparent set to true', () => {
    // Mock reduceTransparentAtom to be true
    ;(useAtomValue as jest.Mock).mockReturnValue(true)

    render(
      <CenterPanelContainer>
        <div>Test Child</div>
      </CenterPanelContainer>
    )

    // Check that the container renders with no border or rounded corners
    const container = screen.getByText('Test Child').parentElement
    expect(container).not.toHaveClass('rounded-lg border')
  })

  it('renders with reduceTransparent set to false', () => {
    // Mock reduceTransparentAtom to be false
    ;(useAtomValue as jest.Mock).mockReturnValue(false)

    render(
      <CenterPanelContainer>
        <div>Test Child</div>
      </CenterPanelContainer>
    )

    // Check that the container renders with border and rounded corners
    const container = screen.getByText('Test Child').parentElement
    expect(container).toHaveClass('rounded-lg border')
  })

  it('renders children correctly', () => {
    // Mock reduceTransparentAtom to be true for this test
    ;(useAtomValue as jest.Mock).mockReturnValue(true)

    render(
      <CenterPanelContainer>
        <div>Child Content</div>
      </CenterPanelContainer>
    )

    // Verify that the child content is rendered
    expect(screen.getByText('Child Content')).toBeInTheDocument()
  })
})
