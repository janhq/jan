import { renderHook, act } from '@testing-library/react'
import { useMediaQuery, getInitialValue } from './index'

const global = globalThis
const originalWindow = global.window

describe('@joi/hooks/useMediaQuery', () => {
  const matchMediaMock = jest.fn()

  beforeAll(() => {
    window.matchMedia = matchMediaMock
  })

  afterEach(() => {
    matchMediaMock.mockClear()
    global.window = originalWindow
  })

  it('should return undetermined when window is undefined', () => {
    delete (global as any).window
    expect(getInitialValue('(max-width: 600px)', true)).toBe(true)
    expect(getInitialValue('(max-width: 600px)', false)).toBe(false)
  })

  it('should return default return false', () => {
    delete (global as any).window
    expect(getInitialValue('(max-width: 600px)')).toBe(false)
  })

  it('should return matchMedia result when window is defined and matchMedia exists', () => {
    // Mock window.matchMedia
    const matchMediaMock = jest.fn().mockImplementation((query) => ({
      matches: query === '(max-width: 600px)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }))

    // Mock window and matchMedia
    ;(global as any).window = { matchMedia: matchMediaMock }

    // Test the function behavior
    expect(getInitialValue('(max-width: 600px)')).toBe(true) // Query should match
    expect(matchMediaMock).toHaveBeenCalledWith('(max-width: 600px)')

    // Test with a non-matching query
    expect(getInitialValue('(min-width: 1200px)')).toBe(false) // Query should not match
    expect(matchMediaMock).toHaveBeenCalledWith('(min-width: 1200px)')
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

  it('should return undefined when matchMedia is not available', () => {
    delete (global as any).window.matchMedia

    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(result.current).toBe(undefined)
  })

  it('should use initialValue when getInitialValueInEffect is true', () => {
    const { result } = renderHook(() =>
      useMediaQuery('(max-width: 600px)', true, {
        getInitialValueInEffect: true,
      })
    )
    expect(result.current).toBe(true)
  })

  it('should use getInitialValue when getInitialValueInEffect is false', () => {
    const { result } = renderHook(() =>
      useMediaQuery('(max-width: 600px)', undefined, {
        getInitialValueInEffect: false,
      })
    )
    expect(result.current).toBe(false)
  })

  it('should use initialValue as false when getInitialValueInEffect is true', () => {
    const { result } = renderHook(() =>
      useMediaQuery('(max-width: 600px)', false, {
        getInitialValueInEffect: true,
      })
    )
    expect(result.current).toBe(false)
  })
})
