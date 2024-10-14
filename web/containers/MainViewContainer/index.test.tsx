import '@testing-library/jest-dom'

import { render } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import MainViewContainer from './index'
import { MainViewState } from '@/constants/screens'

// Mocking the Jotai atom
jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')

  return {
    ...originalModule,
    useAtomValue: jest.fn(),
  }
})

// Mocking the screen components
jest.mock('@/screens/Hub', () => () => <div>Hub Screen</div>)
jest.mock('@/screens/LocalServer', () => () => <div>Local Server Screen</div>)
jest.mock('@/screens/Settings', () => () => <div>Settings Screen</div>)
jest.mock('@/screens/Thread', () => () => <div>Thread Screen</div>)

describe('MainViewContainer', () => {
  it('renders HubScreen when mainViewState is Hub', () => {
    ;(useAtomValue as jest.Mock).mockReturnValue(MainViewState.Hub)

    const { getByText } = render(<MainViewContainer />)

    expect(getByText('Hub Screen')).toBeInTheDocument()
  })

  it('renders SettingsScreen when mainViewState is Settings', () => {
    ;(useAtomValue as jest.Mock).mockReturnValue(MainViewState.Settings)

    const { getByText } = render(<MainViewContainer />)

    expect(getByText('Settings Screen')).toBeInTheDocument()
  })

  it('renders LocalServerScreen when mainViewState is LocalServer', () => {
    ;(useAtomValue as jest.Mock).mockReturnValue(MainViewState.LocalServer)

    const { getByText } = render(<MainViewContainer />)

    expect(getByText('Local Server Screen')).toBeInTheDocument()
  })

  it('renders ThreadScreen when mainViewState is not defined', () => {
    ;(useAtomValue as jest.Mock).mockReturnValue(undefined)

    const { getByText } = render(<MainViewContainer />)

    expect(getByText('Thread Screen')).toBeInTheDocument()
  })
})
