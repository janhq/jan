import { renderHook, act } from '@testing-library/react'
import { useConfigurations } from './useConfigurations'
import { useAtomValue } from 'jotai'
import { extensionManager } from '@/extension'

// Mock dependencies
jest.mock('jotai', () => {
    const originalModule = jest.requireActual('jotai')
    return {
        ...originalModule,
        useAtomValue: jest.fn(),
    }
})

jest.mock('@/extension', () => ({
  extensionManager: {
    get: jest.fn(),
  },
}))

describe('useConfigurations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should call configurePullOptions with correct proxy settings when proxy is enabled', () => {
    // Explicitly set mock return values for each call
    (useAtomValue as jest.Mock)
      .mockReturnValueOnce(true)       // proxyEnabled
      .mockReturnValueOnce('http://proxy.example.com')  // proxyUrl
      .mockReturnValueOnce('')         // proxyIgnoreSSL
      .mockReturnValueOnce(true)       // verifyProxySSL
      .mockReturnValueOnce(true)       // verifyProxyHostSSL
      .mockReturnValueOnce(true)       // verifyPeerSSL
      .mockReturnValueOnce(true)       // verifyHostSSL
      .mockReturnValueOnce('')         // noProxy
      .mockReturnValueOnce('username') // proxyUsername
      .mockReturnValueOnce('password') // proxyPassword


    const mockConfigurePullOptions = jest.fn()
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      configurePullOptions: mockConfigurePullOptions,
    })

    const { result } = renderHook(() => useConfigurations())

    act(() => {
      result.current.configurePullOptions()
    })

    expect(mockConfigurePullOptions).toHaveBeenCalledWith({
      proxy_username: 'username',
      proxy_password: 'password',
      proxy_url: 'http://proxy.example.com',
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
      no_proxy: '',
    })
  })
  
  it('should call configurePullOptions with empty proxy settings when proxy is disabled', () => {
    // Mock atom values
    ;(useAtomValue as jest.Mock)
      .mockReturnValueOnce(false) // proxyEnabled
      .mockReturnValueOnce('') // proxyUrl
      .mockReturnValueOnce(false) // proxyIgnoreSSL
      .mockReturnValueOnce('') // noProxy
      .mockReturnValueOnce('') // proxyUsername
      .mockReturnValueOnce('') // proxyPassword
      .mockReturnValueOnce(false) // verifyProxySSL
      .mockReturnValueOnce(false) // verifyProxyHostSSL
      .mockReturnValueOnce(false) // verifyPeerSSL
      .mockReturnValueOnce(false) // verifyHostSSL

    const mockConfigurePullOptions = jest.fn()
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      configurePullOptions: mockConfigurePullOptions,
    })

    const { result } = renderHook(() => useConfigurations())

    act(() => {
      result.current.configurePullOptions()
    })

    expect(mockConfigurePullOptions).toHaveBeenCalledWith({
      proxy_username: '',
      proxy_password: '',
      proxy_url: '',
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: false,
      verify_host_ssl: false,
      no_proxy: '',
    })
  })

  it('should set all verify SSL to false when proxyIgnoreSSL is true', () => {
    // Mock atom values
    ;(useAtomValue as jest.Mock)
      .mockReturnValueOnce(true)       // proxyEnabled
      .mockReturnValueOnce('http://proxy.example.com')  // proxyUrl
      .mockReturnValueOnce(true)         // proxyIgnoreSSL
      .mockReturnValueOnce(true)       // verifyProxySSL
      .mockReturnValueOnce(true)       // verifyProxyHostSSL
      .mockReturnValueOnce(true)       // verifyPeerSSL
      .mockReturnValueOnce(true)       // verifyHostSSL
      .mockReturnValueOnce('')         // noProxy
      .mockReturnValueOnce('username') // proxyUsername
      .mockReturnValueOnce('password') // proxyPassword

    const mockConfigurePullOptions = jest.fn()
    ;(extensionManager.get as jest.Mock).mockReturnValue({
      configurePullOptions: mockConfigurePullOptions,
    })

    const { result } = renderHook(() => useConfigurations())

    act(() => {
      result.current.configurePullOptions()
    })

    expect(mockConfigurePullOptions).toHaveBeenCalledWith({
      proxy_username: 'username',
      proxy_password: 'password',
      proxy_url: 'http://proxy.example.com',
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: false,
      verify_host_ssl: false,
      no_proxy: '',
    })
  })
}) 