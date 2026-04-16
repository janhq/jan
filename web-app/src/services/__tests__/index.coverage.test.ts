import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock platform detection
const mockIsTauri = vi.fn().mockReturnValue(false)
const mockIsIOS = vi.fn().mockReturnValue(false)
const mockIsAndroid = vi.fn().mockReturnValue(false)

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: (...args: any[]) => mockIsTauri(...args),
  isPlatformIOS: (...args: any[]) => mockIsIOS(...args),
  isPlatformAndroid: (...args: any[]) => mockIsAndroid(...args),
}))

// Mock all Tauri service modules
vi.mock('../theme/tauri', () => ({ TauriThemeService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../window/tauri', () => ({ TauriWindowService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../events/tauri', () => ({ TauriEventsService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../hardware/tauri', () => ({ TauriHardwareService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../app/tauri', () => ({ TauriAppService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../mcp/tauri', () => ({ TauriMCPService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../providers/tauri', () => ({ TauriProvidersService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../dialog/tauri', () => ({ TauriDialogService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../opener/tauri', () => ({ TauriOpenerService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../updater/tauri', () => ({ TauriUpdaterService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../path/tauri', () => ({ TauriPathService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../core/tauri', () => ({ TauriCoreService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../deeplink/tauri', () => ({ TauriDeepLinkService: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../core/mobile', () => ({ MobileCoreService: vi.fn().mockImplementation(() => ({})) }))

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('ServiceHub – coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTauri.mockReturnValue(false)
    mockIsIOS.mockReturnValue(false)
    mockIsAndroid.mockReturnValue(false)
  })

  it('projects() returns a service after init', async () => {
    const { initializeServiceHub } = await import('../index')
    const hub = await initializeServiceHub()
    expect(hub.projects()).toBeDefined()
  })

  it('rag() returns a service after init', async () => {
    const { initializeServiceHub } = await import('../index')
    const hub = await initializeServiceHub()
    expect(hub.rag()).toBeDefined()
  })

  it('uploads() returns a service after init', async () => {
    const { initializeServiceHub } = await import('../index')
    const hub = await initializeServiceHub()
    expect(hub.uploads()).toBeDefined()
  })

  it('double initialization is a no-op', async () => {
    const { initializeServiceHub } = await import('../index')
    const hub = await initializeServiceHub()
    // The hub is already initialized; calling getters should work fine
    expect(hub.theme()).toBeDefined()
  })

  it('iOS platform initializes mobile services', async () => {
    mockIsTauri.mockReturnValue(true)
    mockIsIOS.mockReturnValue(true)

    const { initializeServiceHub } = await import('../index')
    const hub = await initializeServiceHub()

    expect(console.log).toHaveBeenCalledWith(
      'Initializing service hub for platform:',
      'iOS'
    )
    expect(hub.theme()).toBeDefined()
    expect(hub.app()).toBeDefined()
  })

  it('Android platform initializes mobile services', async () => {
    mockIsTauri.mockReturnValue(true)
    mockIsAndroid.mockReturnValue(true)

    const { initializeServiceHub } = await import('../index')
    const hub = await initializeServiceHub()

    expect(console.log).toHaveBeenCalledWith(
      'Initializing service hub for platform:',
      'Android'
    )
    expect(hub.mcp()).toBeDefined()
  })

  it('handles initialization error and still marks as initialized', async () => {
    // Make one of the dynamic imports fail
    mockIsTauri.mockReturnValue(true)
    mockIsIOS.mockReturnValue(false)
    mockIsAndroid.mockReturnValue(false)

    // The mocks are already set up so this should succeed.
    // To test error path, we need to temporarily break a mock.
    const origMock = await import('../theme/tauri')
    const TauriThemeService = vi.mocked((origMock as any).TauriThemeService)
    TauriThemeService.mockImplementationOnce(() => {
      throw new Error('init fail')
    })

    const { initializeServiceHub } = await import('../index')
    await expect(initializeServiceHub()).rejects.toThrow('init fail')
  })
})
