import { renderHook } from '@testing-library/react'
import { useOs, getOS } from './index'
import '@testing-library/jest-dom'

const platforms = {
  windows: [
    'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:47.0) Gecko/20100101 Firefox/47.0',
  ],
  macos: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X x.y; rv:42.0) Gecko/20100101 Firefox/42.0',
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36',
  ],
  ios: [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Mobile/15E148 Safari/604.1',
  ],
  android: [
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
  ],
  undetermined: ['UNKNOWN'],
} as const

describe('@joi/hooks/useOS', () => {
  const global = globalThis
  const originalWindow = global.window

  afterEach(() => {
    global.window = originalWindow
    jest.clearAllMocks()
  })

  it('should return undetermined when window is undefined', () => {
    delete (global as any).window
    expect(getOS()).toBe('undetermined')
  })

  it('should return undetermined when getValueInEffect is false', () => {
    jest
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValueOnce('UNKNOWN_USER_AGENT')

    const { result } = renderHook(() => useOs({ getValueInEffect: false }))
    expect(result.current).toBe('undetermined')
  })

  Object.entries(platforms).forEach(([os, userAgents]) => {
    it.each(userAgents)(`should detect %s platform on ${os}`, (userAgent) => {
      jest
        .spyOn(window.navigator, 'userAgent', 'get')
        .mockReturnValueOnce(userAgent)

      const { result } = renderHook(() => useOs())

      expect(result.current).toBe(os)
    })
  })
})
