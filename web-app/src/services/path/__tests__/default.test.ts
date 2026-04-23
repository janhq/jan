import { describe, it, expect, vi } from 'vitest'
import { DefaultPathService } from '../default'

describe('DefaultPathService', () => {
  it('sep() returns "/"', () => {
    const svc = new DefaultPathService()
    expect(svc.sep()).toBe('/')
  })

  it('join() logs and returns empty string', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultPathService()
    expect(await svc.join('a', 'b')).toBe('')
    expect(spy).toHaveBeenCalledWith('path.join called with segments:', ['a', 'b'])
    spy.mockRestore()
  })

  it('dirname() logs and returns empty string', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultPathService()
    expect(await svc.dirname('/foo/bar')).toBe('')
    expect(spy).toHaveBeenCalledWith('path.dirname called with path:', '/foo/bar')
    spy.mockRestore()
  })

  it('basename() logs and returns empty string', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultPathService()
    expect(await svc.basename('/foo/bar.txt')).toBe('')
    expect(spy).toHaveBeenCalledWith('path.basename called with path:', '/foo/bar.txt')
    spy.mockRestore()
  })

  it('extname() logs and returns empty string', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultPathService()
    expect(await svc.extname('file.txt')).toBe('')
    expect(spy).toHaveBeenCalledWith('path.extname called with path:', 'file.txt')
    spy.mockRestore()
  })
})
