import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './index'

describe('@joi/hooks/useMediaQuery', () => {
  const matchMediaMock = jest.fn()

  beforeAll(() => {
    window.matchMedia = matchMediaMock
  })

  afterEach(() => {
    matchMediaMock.mockClear()
  })

  it('should return initial value when getInitialValueInEffect is true', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }))

    const { result } = renderHook(() =>
      useMediaQuery('(min-width: 768px)', true, {
        getInitialValueInEffect: true,
      })
    )

    expect(result.current).toBe(true)
  })

  it('should return correct value based on media query', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }))

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(true)
  })

  it('should update value when media query changes', () => {
    let listener: ((event: { matches: boolean }) => void) | null = null

    matchMediaMock.mockImplementation(() => ({
      matches: false,
      addEventListener: (_, cb) => {
        listener = cb
      },
      removeEventListener: jest.fn(),
    }))

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(false)

    act(() => {
      if (listener) {
        listener({ matches: true })
      }
    })

    expect(result.current).toBe(true)
  })

  it('should handle older browsers without addEventListener', () => {
    let listener: ((event: { matches: boolean }) => void) | null = null

    matchMediaMock.mockImplementation(() => ({
      matches: false,
      addListener: (cb) => {
        listener = cb
      },
      removeListener: jest.fn(),
    }))

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(false)

    act(() => {
      if (listener) {
        listener({ matches: true })
      }
    })

    expect(result.current).toBe(true)
  })
})
