/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ProxySettings from '.'

// Mock ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as any

// Mock global window.core
global.window.core = {
  api: {
    getAppConfigurations: () => jest.fn(),
    updateAppConfiguration: () => jest.fn(),
    relaunch: () => jest.fn(),
  },
}

// Mock dependencies
jest.mock('@/hooks/useConfigurations', () => ({
  useConfigurations: () => ({
    configurePullOptions: jest.fn(),
  }),
}))

jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtom: jest.fn().mockImplementation((atom) => {
      switch (atom) {
        case 'proxyEnabledAtom':
          return [true, jest.fn()]
        case 'proxyAtom':
          return ['', jest.fn()]
        case 'proxyUsernameAtom':
          return ['', jest.fn()]
        case 'proxyPasswordAtom':
          return ['', jest.fn()]
        case 'ignoreSslAtom':
          return [false, jest.fn()]
        case 'verifyProxySslAtom':
          return [true, jest.fn()]
        case 'verifyProxyHostSslAtom':
          return [true, jest.fn()]
        case 'verifyPeerSslAtom':
          return [true, jest.fn()]
        case 'verifyHostSslAtom':
          return [true, jest.fn()]
        case 'noProxyAtom':
          return ['localhost', jest.fn()]
        default:
          return [null, jest.fn()]
      }
    }),
  }
})

describe('ProxySettings', () => {
  const mockOnBack = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the component', async () => {
    render(<ProxySettings onBack={mockOnBack} />)

    await waitFor(() => {
      expect(screen.getByText('HTTPS Proxy')).toBeInTheDocument()
      expect(screen.getByText('Proxy URL')).toBeInTheDocument()
      expect(screen.getByText('Authentication')).toBeInTheDocument()
      expect(screen.getByText('No Proxy')).toBeInTheDocument()
      expect(screen.getByText('SSL Verification')).toBeInTheDocument()
    })
  })

  it('handles back navigation', async () => {
    render(<ProxySettings onBack={mockOnBack} />)

    const backButton = screen.getByText('Advanced Settings')
    fireEvent.click(backButton)

    expect(mockOnBack).toHaveBeenCalled()
  })

  it('toggles password visibility', () => {
    render(<ProxySettings onBack={mockOnBack} />)

    const passwordVisibilityToggle = screen.getByTestId('password-visibility-toggle')
    const passwordInput = screen.getByTestId('proxy-password')
    
    expect(passwordInput).toHaveAttribute('type', 'password')
    
    fireEvent.click(passwordVisibilityToggle)
    expect(passwordInput).toHaveAttribute('type', 'text')

    fireEvent.click(passwordVisibilityToggle)
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('allows clearing input fields', async () => {
    render(<ProxySettings onBack={mockOnBack} />)

    // Test clearing proxy URL
    const proxyInput = screen.getByTestId('proxy-input')
    fireEvent.change(proxyInput, { target: { value: 'http://test.proxy' } })
    
    const clearProxyButton = screen.getByTestId('clear-proxy-button')
    fireEvent.click(clearProxyButton)
    expect(proxyInput).toHaveValue('')

    // Test clearing username
    const usernameInput = screen.getByTestId('proxy-username')
    fireEvent.change(usernameInput, { target: { value: 'testuser' } })

    // Test clearing password
    const passwordInput = screen.getByTestId('proxy-password')
    fireEvent.change(passwordInput, { target: { value: 'testpassword' } })
  })

  it('renders SSL verification switches', async () => {
    render(<ProxySettings onBack={mockOnBack} />)

    const sslSwitches = [
      'Ignore SSL certificates',
      'Verify Proxy SSL',
      'Verify Proxy Host SSL',
      'Verify Peer SSL',
      'Verify Host SSL'
    ]

    sslSwitches.forEach(switchText => {
      const switchElement = screen.getByText(switchText)
      expect(switchElement).toBeInTheDocument()
    })
  })
}) 