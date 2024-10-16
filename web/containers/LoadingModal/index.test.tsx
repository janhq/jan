import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import ResettingModal from './index'

// Mocking the Jotai atom
jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')

  return {
    ...originalModule,
    useAtomValue: jest.fn(),
  }
})

describe('ResettingModal', () => {
  it('renders the modal with loading info when provided', () => {
    const mockLoadingInfo = {
      title: 'Loading...',
      message: 'Please wait while we process your request.',
    }

    // Mock the useAtomValue hook to return mock loading info
    ;(useAtomValue as jest.Mock).mockReturnValue(mockLoadingInfo)

    const { getByText } = render(<ResettingModal />)

    // Check if the modal title and message are displayed
    expect(getByText('Loading...')).toBeInTheDocument()
    expect(
      getByText('Please wait while we process your request.')
    ).toBeInTheDocument()
  })

  it('does not render the modal when loading info is undefined', () => {
    // Mock the useAtomValue hook to return undefined
    ;(useAtomValue as jest.Mock).mockReturnValue(undefined)

    const { queryByText } = render(<ResettingModal />)

    // Check that the modal does not appear
    expect(queryByText('Loading...')).not.toBeInTheDocument()
    expect(
      queryByText('Please wait while we process your request.')
    ).not.toBeInTheDocument()
  })
})
