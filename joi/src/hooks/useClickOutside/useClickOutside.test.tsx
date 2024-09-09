import React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { useClickOutside } from './index'

// Mock component to test the hook
const TestComponent: React.FC<{ onClickOutside: () => void }> = ({
  onClickOutside,
}) => {
  const ref = useClickOutside(onClickOutside)
  return <div ref={ref as React.RefObject<HTMLDivElement>}>Test</div>
}

describe('@joi/hooks/useClickOutside', () => {
  it('should call handler when clicking outside', () => {
    const handleClickOutside = jest.fn()
    const { container } = render(
      <TestComponent onClickOutside={handleClickOutside} />
    )

    act(() => {
      fireEvent.mouseDown(document.body)
    })

    expect(handleClickOutside).toHaveBeenCalledTimes(1)
  })

  it('should not call handler when clicking inside', () => {
    const handleClickOutside = jest.fn()
    const { getByText } = render(
      <TestComponent onClickOutside={handleClickOutside} />
    )

    act(() => {
      fireEvent.mouseDown(getByText('Test'))
    })

    expect(handleClickOutside).not.toHaveBeenCalled()
  })

  it('should work with custom events', () => {
    const handleClickOutside = jest.fn()
    const TestComponentWithCustomEvent: React.FC = () => {
      const ref = useClickOutside(handleClickOutside, ['click'])
      return <div ref={ref as React.RefObject<HTMLDivElement>}>Test</div>
    }

    render(<TestComponentWithCustomEvent />)

    act(() => {
      fireEvent.click(document.body)
    })

    expect(handleClickOutside).toHaveBeenCalledTimes(1)
  })
})
