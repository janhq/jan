/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import Advanced from '.'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock
global.window.core = {
  api: {
    getAppConfigurations: () => jest.fn(),
    updateAppConfiguration: () => jest.fn(),
    relaunch: () => jest.fn(),
  },
}

const setSettingsMock = jest.fn()

// Mock useSettings hook
jest.mock('@/hooks/useSettings', () => ({
  __esModule: true,
  useSettings: () => ({
    readSettings: () => ({
      run_mode: 'gpu',
      experimental: false,
      proxy: false,
      gpus: [{ name: 'gpu-1' }, { name: 'gpu-2' }],
      gpus_in_use: ['0'],
      quick_ask: false,
    }),
    setSettings: setSettingsMock,
  }),
}))

import * as toast from '@/containers/Toast'

jest.mock('@/containers/Toast')

jest.mock('@janhq/core', () => ({
  __esModule: true,
  ...jest.requireActual('@janhq/core'),
  fs: {
    rm: jest.fn(),
  },
}))

// Simulate a full advanced settings screen
// @ts-ignore
global.isMac = false
// @ts-ignore
global.isWindows = true

describe('Advanced', () => {
  it('renders the component', async () => {
    render(<Advanced />)
    await waitFor(() => {
      expect(screen.getByText('Experimental Mode')).toBeInTheDocument()
      expect(screen.getByText('HTTPS Proxy')).toBeInTheDocument()
      expect(screen.getByText('Ignore SSL certificates')).toBeInTheDocument()
      expect(screen.getByText('Jan Data Folder')).toBeInTheDocument()
      expect(screen.getByText('Reset to Factory Settings')).toBeInTheDocument()
    })
  })

  it('updates Experimental enabled', async () => {
    render(<Advanced />)
    let experimentalToggle
    await waitFor(() => {
      experimentalToggle = screen.getByTestId(/experimental-switch/i)
      fireEvent.click(experimentalToggle!)
    })
    expect(experimentalToggle).toBeChecked()
  })

  it('updates Experimental disabled', async () => {
    render(<Advanced />)

    let experimentalToggle
    await waitFor(() => {
      experimentalToggle = screen.getByTestId(/experimental-switch/i)
      fireEvent.click(experimentalToggle!)
    })
    expect(experimentalToggle).not.toBeChecked()
  })

  it('toggles proxy enabled', async () => {
    render(<Advanced />)
    let proxyToggle
    await waitFor(() => {
      expect(screen.getByText('HTTPS Proxy')).toBeInTheDocument()
      proxyToggle = screen.getByTestId(/proxy-switch/i)
      fireEvent.click(proxyToggle)
    })
    expect(proxyToggle).toBeChecked()
  })

  it('updates proxy settings', async () => {
    render(<Advanced />)
    let proxyInput
    await waitFor(() => {
      const proxyToggle = screen.getByTestId(/proxy-switch/i)
      fireEvent.click(proxyToggle)
      proxyInput = screen.getByTestId(/proxy-input/i)
      fireEvent.change(proxyInput, { target: { value: 'http://proxy.com' } })
    })
    expect(proxyInput).toHaveValue('http://proxy.com')
  })

  it('toggles ignore SSL certificates', async () => {
    render(<Advanced />)
    let ignoreSslToggle
    await waitFor(() => {
      expect(screen.getByText('Ignore SSL certificates')).toBeInTheDocument()
      ignoreSslToggle = screen.getByTestId(/ignore-ssl-switch/i)
      fireEvent.click(ignoreSslToggle)
    })
    expect(ignoreSslToggle).toBeChecked()
  })

  it('renders DataFolder component', async () => {
    render(<Advanced />)
    await waitFor(() => {
      expect(screen.getByText('Jan Data Folder')).toBeInTheDocument()
      expect(screen.getByTestId(/jan-data-folder-input/i)).toBeInTheDocument()
    })
  })

  it('renders FactoryReset component', async () => {
    render(<Advanced />)
    await waitFor(() => {
      expect(screen.getByText('Reset to Factory Settings')).toBeInTheDocument()
      expect(screen.getByTestId(/reset-button/i)).toBeInTheDocument()
    })
  })
})
