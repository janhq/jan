// useLogs.test.ts

import { renderHook, act } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { fs, joinPath, openFileExplorer } from '@janhq/core'

import { useLogs } from './useLogs'

// Mock dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  atom: jest.fn(),
}))

jest.mock('@janhq/core', () => ({
  fs: {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  },
  joinPath: jest.fn(),
  openFileExplorer: jest.fn(),
}))

describe('useLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAtomValue as jest.Mock).mockReturnValue('/mock/jan/data/folder')
  })

  it('should get logs and sanitize them', async () => {
    const mockLogs = '/mock/jan/data/folder/some/log/content'
    const expectedSanitizedLogs = 'jan-data-folder/some/log/content'

    ;(joinPath as jest.Mock).mockResolvedValue('file://logs/test.log')
    ;(fs.existsSync as jest.Mock).mockResolvedValue(true)
    ;(fs.readFileSync as jest.Mock).mockResolvedValue(mockLogs)

    const { result } = renderHook(() => useLogs())

    await act(async () => {
      const logs = await result.current.getLogs('test')
      expect(logs).toBe(expectedSanitizedLogs)
    })

    expect(joinPath).toHaveBeenCalledWith(['file://logs', 'test.log'])
    expect(fs.existsSync).toHaveBeenCalledWith('file://logs/test.log')
    expect(fs.readFileSync).toHaveBeenCalledWith(
      'file://logs/test.log',
      'utf-8'
    )
  })

  it('should return empty string if log file does not exist', async () => {
    ;(joinPath as jest.Mock).mockResolvedValue('file://logs/nonexistent.log')
    ;(fs.existsSync as jest.Mock).mockResolvedValue(false)

    const { result } = renderHook(() => useLogs())

    await act(async () => {
      const logs = await result.current.getLogs('nonexistent')
      expect(logs).toBe('')
    })

    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('should open server log', async () => {
    ;(joinPath as jest.Mock).mockResolvedValue(
      '/mock/jan/data/folder/logs/app.log'
    )
    ;(openFileExplorer as jest.Mock).mockResolvedValue(undefined)

    const { result } = renderHook(() => useLogs())

    await act(async () => {
      await result.current.openServerLog()
    })

    expect(joinPath).toHaveBeenCalledWith([
      '/mock/jan/data/folder',
      'logs',
      'app.log',
    ])
    expect(openFileExplorer).toHaveBeenCalledWith(
      '/mock/jan/data/folder/logs/app.log'
    )
  })

  it('should clear server log', async () => {
    ;(joinPath as jest.Mock).mockResolvedValue('file://logs/app.log')
    ;(fs.writeFileSync as jest.Mock).mockResolvedValue(undefined)

    const { result } = renderHook(() => useLogs())

    await act(async () => {
      await result.current.clearServerLog()
    })

    expect(joinPath).toHaveBeenCalledWith(['file://logs', 'app.log'])
    expect(fs.writeFileSync).toHaveBeenCalledWith('file://logs/app.log', '')
  })
})
