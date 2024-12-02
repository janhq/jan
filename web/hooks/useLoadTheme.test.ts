import { renderHook, act } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { fs, joinPath } from '@janhq/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { useLoadTheme } from './useLoadTheme'
import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  selectedThemeIdAtom,
  themeDataAtom,
} from '@/helpers/atoms/Setting.atom'

// Mock dependencies
jest.mock('next-themes')
jest.mock('@janhq/core')

// Mock dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))

describe('useLoadTheme', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const mockJanDataFolderPath = '/mock/path'
  const mockThemesPath = '/mock/path/themes'
  const mockSelectedThemeId = 'joi-light'
  const mockThemeData = {
    id: 'joi-light',
    displayName: 'Joi Light',
    nativeTheme: 'light',
    variables: {
      '--primary-color': '#007bff',
    },
  }

  it('should load theme and set variables', async () => {
    // Mock Jotai hooks
    ;(useAtomValue as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case janDataFolderPathAtom:
          return mockJanDataFolderPath
        default:
          return undefined
      }
    })
    ;(useSetAtom as jest.Mock).mockReturnValue(jest.fn())
    ;(useAtom as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case selectedThemeIdAtom:
          return [mockSelectedThemeId, jest.fn()]
        case themeDataAtom:
          return [mockThemeData, jest.fn()]
        default:
          return [undefined, jest.fn()]
      }
    })

    // Mock fs and joinPath
    ;(fs.readdirSync as jest.Mock).mockResolvedValue(['joi-light', 'joi-dark'])
    ;(fs.readFileSync as jest.Mock).mockResolvedValue(
      JSON.stringify(mockThemeData)
    )
    ;(joinPath as jest.Mock).mockImplementation((paths) => paths.join('/'))

    // Mock setTheme from next-themes
    const mockSetTheme = jest.fn()
    ;(useTheme as jest.Mock).mockReturnValue({ setTheme: mockSetTheme })

    // Mock window.electronAPI
    Object.defineProperty(window, 'electronAPI', {
      value: {
        setNativeThemeLight: jest.fn(),
        setNativeThemeDark: jest.fn(),
      },
      writable: true,
    })

    const { result } = renderHook(() => useLoadTheme())

    await act(async () => {
      await result.current
    })

    // Assertions
    expect(fs.readdirSync).toHaveBeenCalledWith(mockThemesPath)
    expect(fs.readFileSync).toHaveBeenCalledWith(
      `${mockThemesPath}/${mockSelectedThemeId}/theme.json`,
      'utf-8'
    )
    expect(mockSetTheme).toHaveBeenCalledWith('light')
    expect(window.electronAPI.setNativeThemeLight).toHaveBeenCalled()
  })

  it('should set default theme if no selected theme', async () => {
    // Mock Jotai hooks with empty selected theme
    ;(useAtomValue as jest.Mock).mockReturnValue(mockJanDataFolderPath)
    ;(useSetAtom as jest.Mock).mockReturnValue(jest.fn())
    ;(useAtom as jest.Mock).mockReturnValue(['', jest.fn()])
    ;(useAtom as jest.Mock).mockReturnValue([{}, jest.fn()])

    const mockSetSelectedThemeId = jest.fn()
    ;(useAtom as jest.Mock).mockReturnValue(['', mockSetSelectedThemeId])

    const { result } = renderHook(() => useLoadTheme())

    await act(async () => {
      await result.current
    })

    expect(mockSetSelectedThemeId).toHaveBeenCalledWith('joi-light')
  })

  it('should handle missing janDataFolderPath', async () => {
    // Mock Jotai hooks with empty janDataFolderPath
    ;(useAtomValue as jest.Mock).mockReturnValue('')

    const { result } = renderHook(() => useLoadTheme())

    await act(async () => {
      await result.current
    })

    expect(fs.readdirSync).not.toHaveBeenCalled()
  })
})
