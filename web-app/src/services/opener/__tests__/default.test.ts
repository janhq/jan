import { describe, it, expect, vi } from 'vitest'

import { DefaultOpenerService } from '../default'

describe('DefaultOpenerService', () => {
  it('revealItemInDir resolves and logs the path', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultOpenerService()
    await expect(svc.revealItemInDir('/some/path')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('revealItemInDir called with path:', '/some/path')
    spy.mockRestore()
  })

  it('revealItemInDir handles empty string path', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultOpenerService()
    await expect(svc.revealItemInDir('')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('revealItemInDir called with path:', '')
    spy.mockRestore()
  })
})
