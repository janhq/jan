import { renderHook, act } from '@testing-library/react'
import { useAtomValue, useSetAtom } from 'jotai'
import useFactoryReset, { FactoryResetState } from './useFactoryReset'
import { useActiveModel } from './useActiveModel'
import { fs } from '@janhq/core'

// Mock the dependencies
jest.mock('jotai', () => ({
  atom: jest.fn(),
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
}))
jest.mock('./useActiveModel', () => ({
  useActiveModel: jest.fn(),
}))
jest.mock('@janhq/core', () => ({
  fs: {
    rm: jest.fn(),
  },
  EngineManager: {
    instance: jest.fn().mockReturnValue({
      get: jest.fn(),
      engines: {},
    }),
  },
}))

describe('useFactoryReset', () => {
  const mockStopModel = jest.fn()
  const mockSetFactoryResetState = jest.fn()
  const mockGetAppConfigurations = jest.fn()
  const mockUpdateAppConfiguration = jest.fn()
  const mockRelaunch = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAtomValue as jest.Mock).mockReturnValue('/default/jan/data/folder')
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetFactoryResetState)
    ;(useActiveModel as jest.Mock).mockReturnValue({ stopModel: mockStopModel })
    global.window ??= Object.create(window)
    global.window.core = {
      api: {
        getAppConfigurations: mockGetAppConfigurations,
        updateAppConfiguration: mockUpdateAppConfiguration,
        relaunch: mockRelaunch,
        factoryReset: jest.fn(),
      },
    }
    mockGetAppConfigurations.mockResolvedValue({
      data_folder: '/current/jan/data/folder',
      quick_ask: false,
    })
    // @ts-ignore
    jest.spyOn(global, 'setTimeout').mockImplementation((cb) => cb())
  })

  it('should reset all correctly', async () => {
    const { result } = renderHook(() => useFactoryReset())

    await act(async () => {
      await result.current.resetAll()
    })

    expect(mockSetFactoryResetState).toHaveBeenCalledWith(
      FactoryResetState.Starting
    )
    expect(mockSetFactoryResetState).toHaveBeenCalledWith(
      FactoryResetState.StoppingModel
    )
    expect(mockStopModel).toHaveBeenCalled()
    expect(mockSetFactoryResetState).toHaveBeenCalledWith(
      FactoryResetState.DeletingData
    )
    expect(fs.rm).toHaveBeenCalledWith({ args: ['/current/jan/data/folder'] })
    expect(mockSetFactoryResetState).toHaveBeenCalledWith(
      FactoryResetState.ClearLocalStorage
    )
  })

  it('should keep current folder when specified', async () => {
    const { result } = renderHook(() => useFactoryReset())

    await act(async () => {
      await result.current.resetAll(true)
    })

    expect(mockUpdateAppConfiguration).not.toHaveBeenCalled()
  })
})
