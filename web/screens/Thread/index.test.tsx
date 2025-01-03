import React from 'react'
import { render } from '@testing-library/react'
import ThreadScreen from './index'
import { useStarterScreen } from '../../hooks/useStarterScreen'
import '@testing-library/jest-dom'

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Mock the useStarterScreen hook
jest.mock('@/hooks/useStarterScreen')

// @ts-ignore
global.API_BASE_URL = 'http://localhost:3000'

describe('ThreadScreen', () => {
  it('renders OnDeviceStarterScreen when isShowStarterScreen is true', () => {
    ;(useStarterScreen as jest.Mock).mockReturnValue({
      isShowStarterScreen: true,
      extensionHasSettings: false,
    })

    const { getByText } = render(<ThreadScreen />)
    expect(getByText('Select a model to start')).toBeInTheDocument()
  })

  it('renders Thread panels when isShowStarterScreen is false', () => {
    ;(useStarterScreen as jest.Mock).mockReturnValue({
      isShowStarterScreen: false,
      extensionHasSettings: false,
    })

    const { getByText } = render(<ThreadScreen />)
    expect(getByText('Welcome!')).toBeInTheDocument()
  })
})
