import { describe, it, expect, vi } from 'vitest'
import { DefaultDialogService } from '../default'

describe('DefaultDialogService', () => {
  it('open() logs and returns null', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultDialogService()
    expect(await svc.open({ title: 'Pick' })).toBeNull()
    expect(spy).toHaveBeenCalledWith('dialog.open called with options:', { title: 'Pick' })
    spy.mockRestore()
  })

  it('open() with no options returns null', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultDialogService()
    expect(await svc.open()).toBeNull()
    expect(spy).toHaveBeenCalledWith('dialog.open called with options:', undefined)
    spy.mockRestore()
  })

  it('save() logs and returns null', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultDialogService()
    expect(await svc.save({ title: 'Save' })).toBeNull()
    expect(spy).toHaveBeenCalledWith('dialog.save called with options:', { title: 'Save' })
    spy.mockRestore()
  })

  it('save() with no options returns null', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultDialogService()
    expect(await svc.save()).toBeNull()
    spy.mockRestore()
  })
})
