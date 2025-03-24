import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Provider } from 'jotai'
import OnboardingScreen from './index'
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

jest.mock('@/hooks/useModelSource')

import * as source from '@/hooks/useModelSource'

describe('OnDeviceStarterScreen', () => {
  beforeEach(() => {
    mockAtomValue.mockImplementation(() => [])
    mockSetAtom.mockImplementation(() => jest.fn())
  })
  jest.spyOn(source, 'useGetModelSources').mockReturnValue({
    sources: [],
    error: null,
    mutate: jest.fn(),
  })

  it('renders the component', () => {
    jest.spyOn(source, 'useGetModelSources').mockReturnValue({
      sources: [],
      error: null,
      mutate: jest.fn(),
    })
    jest.spyOn(source, 'useGetFeaturedSources').mockReturnValue([])
    render(
      <Provider>
        <OnboardingScreen isShowStarterScreen={true} />
      </Provider>
    )

    expect(screen.getByText('Select a model to start')).toBeInTheDocument()
    expect(screen.getByTestId('logo-mark')).toBeInTheDocument()
  })

  it('handles search input', () => {
    jest.spyOn(source, 'useGetModelSources').mockReturnValue({
      sources: [],
      error: null,
      mutate: jest.fn(),
    })
    jest.spyOn(source, 'useGetFeaturedSources').mockReturnValue([])
    render(
      <Provider>
        <OnboardingScreen isShowStarterScreen={true} />
      </Provider>
    )

    const searchInput = screen.getByPlaceholderText('Search...')
    fireEvent.change(searchInput, { target: { value: 'test model' } })

    expect(searchInput).toHaveValue('test model')
  })

  it('displays "No Result Found" when no models match the search', () => {
    mockAtomValue.mockImplementation(() => [])

    jest.spyOn(source, 'useGetModelSources').mockReturnValue({
      sources: [],
      error: null,
      mutate: jest.fn(),
    })
    jest.spyOn(source, 'useGetFeaturedSources').mockReturnValue([])
    render(
      <Provider>
        <OnboardingScreen isShowStarterScreen={true} />
      </Provider>
    )

    const searchInput = screen.getByPlaceholderText('Search...')
    fireEvent.change(searchInput, { target: { value: 'nonexistent model' } })

    expect(screen.getByText('No Result Found')).toBeInTheDocument()
  })

  it('renders featured models', () => {
    const mockConfiguredModels = [
      {
        id: 'cortexso/deepseek-r1',
        name: 'DeepSeek R1',
        metadata: {
          author: 'Test Author',
          size: 3000000000,
          tags: ['featured'],
        },
        models: [
          {
            id: 'cortexso/deepseek-r1',
            name: 'DeepSeek R1',
            metadata: {},
          },
        ],
      },
      {
        id: 'cortexso/llama3.2',
        name: 'Llama 3.1',
        metadata: {
          author: 'Test Author',
          size: 2000000000,
          tags: ['featured'],
        },
        models: [
          {
            id: 'cortexso/deepseek-r1',
            name: 'DeepSeek R1',
            metadata: {},
          },
        ],
      },
    ]

    jest.spyOn(source, 'useGetModelSources').mockReturnValue({
      sources: mockConfiguredModels,
      error: null,
      mutate: jest.fn(),
    })
    jest
      .spyOn(source, 'useGetFeaturedSources')
      .mockReturnValue({
        sources: mockConfiguredModels,
        error: null,
        mutate: jest.fn(),
      })

    render(
      <Provider>
        <OnboardingScreen isShowStarterScreen={true} />
      </Provider>
    )

    expect(screen.getAllByText('deepseek-r1')[0]).toBeInTheDocument()
  })

  it('renders cloud models', () => {
    jest.spyOn(source, 'useGetModelSources').mockReturnValue({
      sources: [],
      error: null,
      mutate: jest.fn(),
    })
    const mockRemoteModels = [
      { id: 'remote-model-1', name: 'Remote Model 1', engine: 'openai' },
      { id: 'remote-model-2', name: 'Remote Model 2', engine: 'anthropic' },
    ]

    jest
      .spyOn(source, 'useGetFeaturedSources')
      .mockReturnValue(mockRemoteModels)

    mockAtomValue.mockImplementation((atom) => {
      if (atom === jotai.atom([])) {
        return mockRemoteModels
      }
      return []
    })

    render(
      <Provider>
        <OnboardingScreen isShowStarterScreen={true} />
      </Provider>
    )

    expect(screen.getByText('Cloud Models')).toBeInTheDocument()
  })
})
