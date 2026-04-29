import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { TauriOpenerService } from '../tauri'
import { DefaultOpenerService } from '../default'

describe('TauriOpenerService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('extends DefaultOpenerService', () => {
    const svc = new TauriOpenerService()
    expect(svc).toBeInstanceOf(DefaultOpenerService)
  })

  it('revealItemInDir calls the open_file_explorer Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const svc = new TauriOpenerService()
    await svc.revealItemInDir('/tmp/x')
    expect(invoke).toHaveBeenCalledWith('open_file_explorer', { path: '/tmp/x' })
  })

  it('revealItemInDir logs and rethrows when invoke rejects', async () => {
    const err = new Error('boom')
    vi.mocked(invoke).mockRejectedValueOnce(err)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new TauriOpenerService()
    await expect(svc.revealItemInDir('/tmp/x')).rejects.toBe(err)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('DefaultOpenerService', () => {
  it('revealItemInDir is a no-op that resolves', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultOpenerService()
    await expect(svc.revealItemInDir('/any/path')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith(
      'revealItemInDir called with path:',
      '/any/path'
    )
    spy.mockRestore()
  })
})
