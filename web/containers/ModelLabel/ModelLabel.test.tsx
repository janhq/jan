import React from 'react'
import { render, waitFor, screen } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { useActiveModel } from '@/hooks/useActiveModel'
import { useSettings } from '@/hooks/useSettings'
import ModelLabel from '@/containers/ModelLabel'

jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  atom: jest.fn(),
}))

jest.mock('@/hooks/useActiveModel', () => ({
  useActiveModel: jest.fn(),
}))

jest.mock('@/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}))

describe('ModelLabel', () => {
  const mockUseAtomValue = useAtomValue as jest.Mock
  const mockUseActiveModel = useActiveModel as jest.Mock
  const mockUseSettings = useSettings as jest.Mock

  const defaultProps: any = {
    metadata: {
      author: 'John Doe', // Add the 'author' property with a value
      tags: ['8B'],
      size: 100,
    },
    compact: false,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when minimumRamModel is less than availableRam', () => {
    mockUseAtomValue
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(0)
    mockUseActiveModel.mockReturnValue({
      activeModel: { metadata: { size: 0 } },
    })
    mockUseSettings.mockReturnValue({ settings: { run_mode: 'cpu' } })

    const props = {
      ...defaultProps,
      metadata: {
        ...defaultProps.metadata,
        size: 10,
      },
    }

    const { container } = render(<ModelLabel {...props} />)
    expect(container.firstChild).toBeNull()
  })
})
