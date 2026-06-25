import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdir: vi.fn(),
    mv: vi.fn(),
    rm: vi.fn(),
  },
}))

vi.mock('@janhq/core', () => ({
  getJanDataFolderPath: vi.fn().mockResolvedValue('/jan'),
  joinPath: vi.fn(async (parts: string[]) => parts.join('/')),
  fs: fsMock,
}))

import {
  readSettingsFile,
  writeSettingsFile,
  settingsFileExists,
} from '../settings-store'

beforeEach(() => {
  vi.clearAllMocks()
  fsMock.mv.mockResolvedValue(undefined)
  fsMock.mkdir.mockResolvedValue(undefined)
  fsMock.writeFileSync.mockResolvedValue(undefined)
  fsMock.rm.mockResolvedValue(undefined)
})

describe('settings-store', () => {
  it('returns [] when the file does not exist', async () => {
    fsMock.existsSync.mockResolvedValue(false)
    const result = await readSettingsFile()
    expect(result).toEqual([])
  })

  it('parses an existing settings file', async () => {
    fsMock.existsSync.mockResolvedValue(true)
    const data = [{ key: 'a', controllerProps: { value: 1 } }]
    fsMock.readFileSync.mockResolvedValue(JSON.stringify(data))
    const result = await readSettingsFile()
    expect(result).toEqual(data)
  })

  it('returns [] on malformed JSON instead of throwing', async () => {
    fsMock.existsSync.mockResolvedValue(true)
    fsMock.readFileSync.mockResolvedValue('{not json')
    const result = await readSettingsFile()
    expect(result).toEqual([])
  })

  it('settingsFileExists reflects fs.existsSync', async () => {
    fsMock.existsSync.mockResolvedValueOnce(true)
    expect(await settingsFileExists()).toBe(true)
    fsMock.existsSync.mockResolvedValueOnce(false)
    expect(await settingsFileExists()).toBe(false)
  })

  it('writes via tmp + mv (atomic-ish) and creates the dir if missing', async () => {
    fsMock.existsSync.mockResolvedValue(false)
    await writeSettingsFile([{ key: 'k', controllerProps: { value: 1 } }] as any)
    expect(fsMock.mkdir).toHaveBeenCalledWith('/jan/llamacpp')
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      '/jan/llamacpp/settings.json.tmp',
      expect.any(String)
    )
    expect(fsMock.mv).toHaveBeenCalledWith(
      '/jan/llamacpp/settings.json.tmp',
      '/jan/llamacpp/settings.json'
    )
  })

  it('falls back to direct write when mv fails', async () => {
    fsMock.existsSync.mockResolvedValue(true)
    fsMock.mv.mockRejectedValueOnce(new Error('cross-device'))
    await writeSettingsFile([{ key: 'k', controllerProps: { value: 1 } }] as any)
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      '/jan/llamacpp/settings.json',
      expect.any(String)
    )
  })

  it('serializes concurrent writes', async () => {
    fsMock.existsSync.mockResolvedValue(true)
    let inflight = 0
    let maxInflight = 0
    fsMock.writeFileSync.mockImplementation(async () => {
      inflight += 1
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((r) => setTimeout(r, 5))
      inflight -= 1
    })
    await Promise.all([
      writeSettingsFile([{ key: 'a' }] as any),
      writeSettingsFile([{ key: 'b' }] as any),
      writeSettingsFile([{ key: 'c' }] as any),
    ])
    expect(maxInflight).toBe(1)
  })
})
