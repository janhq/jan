import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Provider } from 'jotai'
import OnDeviceStarterScreen from './index'
import * as jotai from 'jotai'
import '@testing-library/jest-dom'

jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}))

jest.mock('@janhq/joi', () => ({
  Button: (props: any) => <button {...props} />,
  Input: ({ prefixIcon, ...props }: any) => (
    <div>
      {prefixIcon}
      <input {...props} />
    </div>
  ),
  Progress: () => <div data-testid="progress" />,
  ScrollArea: ({ children }: any) => <div>{children}</div>,
  useClickOutside: jest.fn(),
}))

jest.mock('@/containers/Brand/Logo/Mark', () => () => (
  <div data-testid="logo-mark" />
))
jest.mock('@/containers/CenterPanelContainer', () => ({ children }: any) => (
  <div>{children}</div>
))
jest.mock('@/containers/Loader/ProgressCircle', () => () => (
  <div data-testid="progress-circle" />
))
jest.mock('@/containers/ModelLabel', () => () => (
  <div data-testid="model-label" />
))

jest.mock('@/hooks/useDownloadModel', () => ({
  __esModule: true,
  default: () => ({ downloadModel: jest.fn() }),
}))

// Mock the necessary atoms
const mockAtomValue = jest.spyOn(jotai, 'useAtomValue')
const mockSetAtom = jest.spyOn(jotai, 'useSetAtom')

describe('OnDeviceStarterScreen', () => {
  const mockExtensionHasSettings = [
    {
      name: 'Test Extension',
      setting: 'test-setting',
      apiKey: 'test-key',
      provider: 'test-provider',
    },
  ]

  beforeEach(() => {
    mockAtomValue.mockImplementation(() => [])
    mockSetAtom.mockImplementation(() => jest.fn())
  })

  it('renders the component', () => {
    render(
      <Provider>
        <OnDeviceStarterScreen
          extensionHasSettings={mockExtensionHasSettings}
        />
      </Provider>
    )

    expect(screen.getByText('Select a model to start')).toBeInTheDocument()
    expect(screen.getByTestId('logo-mark')).toBeInTheDocument()
  })

  it('handles search input', () => {
    render(
      <Provider>
        <OnDeviceStarterScreen
          extensionHasSettings={mockExtensionHasSettings}
        />
      </Provider>
    )

    const searchInput = screen.getByPlaceholderText('Search...')
    fireEvent.change(searchInput, { target: { value: 'test model' } })

    expect(searchInput).toHaveValue('test model')
  })

  it('displays "No Result Found" when no models match the search', () => {
    mockAtomValue.mockImplementation(() => [])

    render(
      <Provider>
        <OnDeviceStarterScreen
          extensionHasSettings={mockExtensionHasSettings}
        />
      </Provider>
    )

    const searchInput = screen.getByPlaceholderText('Search...')
    fireEvent.change(searchInput, { target: { value: 'nonexistent model' } })

    expect(screen.getByText('No Result Found')).toBeInTheDocument()
  })

  it('renders featured models', () => {
    const mockConfiguredModels = [
      {
        id: 'gemma-2-9b-it',
        name: 'Gemma 2B',
        metadata: {
          tags: ['Featured'],
          author: 'Test Author',
          size: 3000000000,
        },
      },
      {
        id: 'llama3.1-8b-instruct',
        name: 'Llama 3.1',
        metadata: { tags: [], author: 'Test Author', size: 2000000000 },
      },
    ]

    mockAtomValue.mockImplementation((atom) => {
      return mockConfiguredModels
    })

    render(
      <Provider>
        <OnDeviceStarterScreen
          extensionHasSettings={mockExtensionHasSettings}
        />
      </Provider>
    )

    expect(screen.getByText('Gemma 2B')).toBeInTheDocument()
    expect(screen.queryByText('Llama 3.1')).not.toBeInTheDocument()
  })

  it('renders cloud models', () => {
    const mockRemoteModels = [
      { id: 'remote-model-1', name: 'Remote Model 1', engine: 'openai' },
      { id: 'remote-model-2', name: 'Remote Model 2', engine: 'anthropic' },
    ]

    mockAtomValue.mockImplementation((atom) => {
      if (atom === jotai.atom([])) {
        return mockRemoteModels
      }
      return []
    })

    render(
      <Provider>
        <OnDeviceStarterScreen
          extensionHasSettings={mockExtensionHasSettings}
        />
      </Provider>
    )

    expect(screen.getByText('Cloud Models')).toBeInTheDocument()
  })
})
