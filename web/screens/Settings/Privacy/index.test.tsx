/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import Privacy from '.'

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

// Simulate a full Privacy settings screen
// @ts-ignore
global.isMac = false
// @ts-ignore
global.isWindows = true

describe('Privacy', () => {
  it('renders the component', async () => {
    render(<Privacy />)
    await waitFor(() => {
      expect(screen.getByText('Clear logs')).toBeInTheDocument()
    })
  })

  it('clears logs', async () => {
    const jestMock = jest.fn()
    jest.spyOn(toast, 'toaster').mockImplementation(jestMock)

    render(<Privacy />)
    let clearLogsButton
    await waitFor(() => {
      clearLogsButton = screen.getByTestId(/clear-logs/i)
      fireEvent.click(clearLogsButton)
    })
    expect(clearLogsButton).toBeInTheDocument()
    expect(jestMock).toHaveBeenCalled()
  })
})
