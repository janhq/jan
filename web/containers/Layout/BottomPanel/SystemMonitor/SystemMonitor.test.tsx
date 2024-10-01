import '@testing-library/jest-dom'
import React from 'react'
import { render, screen } from '@testing-library/react'
import SystemMonitor from './index'
import { useAtom, useAtomValue } from 'jotai'
import {
  cpuUsageAtom,
  gpusAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

// Mock dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))

// Mock the hooks and atoms
jest.mock('@/hooks/useGetSystemResources', () => ({
  __esModule: true,
  default: () => ({ watch: jest.fn(), stopWatching: jest.fn() }),
}))

jest.mock('@/hooks/usePath', () => ({
  usePath: () => ({ onRevealInFinder: jest.fn() }),
}))

jest.mock('@/helpers/atoms/App.atom', () => ({
  showSystemMonitorPanelAtom: { init: false },
}))

jest.mock('@/helpers/atoms/Setting.atom', () => ({
  reduceTransparentAtom: { init: false },
}))

jest.mock('@/helpers/atoms/SystemBar.atom', () => ({
  totalRamAtom: { init: 16000000000 },
  usedRamAtom: { init: 8000000000 },
  cpuUsageAtom: { init: 50 },
  gpusAtom: { init: [] },
  ramUtilitizedAtom: { init: 50 },
}))

describe('SystemMonitor', () => {
  beforeAll(() => {
    jest.clearAllMocks()
  })
  it('renders without crashing', () => {
    ;(useAtom as jest.Mock).mockReturnValue([false, jest.fn()])
    render(<SystemMonitor />)
    expect(screen.getByText('System Monitor')).toBeInTheDocument()
  })

  it('renders information on expand', () => {
    const mockGpusAtom = jest.fn()
    const mockShowPanel = jest.fn()
    ;(useAtom as jest.Mock).mockImplementation(mockShowPanel)
    // Mock Jotai hooks
    ;(useAtomValue as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case totalRamAtom:
          return 16000000000
        case usedRamAtom:
          return 8000000000
        case cpuUsageAtom:
          return 30
        case gpusAtom:
          return mockGpusAtom
        default:
          return jest.fn()
      }
    })
    mockGpusAtom.mockImplementation(() => [])
    mockShowPanel.mockImplementation(() => [true, jest.fn()])

    render(<SystemMonitor />)

    expect(screen.getByText('Running Models')).toBeInTheDocument()
    expect(screen.getByText('App Log')).toBeInTheDocument()
    expect(screen.getByText('7.45/14.90 GB')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })
})
