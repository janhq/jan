import { describe, it, expect } from 'vitest'
import { DefaultDialogService } from '../default'

describe('DefaultDialogService', () => {
  it('open() returns null', async () => {
    const svc = new DefaultDialogService()
    expect(await svc.open({ title: 'Pick' } as any)).toBeNull()
  })

  it('open() with no options returns null', async () => {
    const svc = new DefaultDialogService()
    expect(await svc.open()).toBeNull()
  })

  it('save() returns null', async () => {
    const svc = new DefaultDialogService()
    expect(await svc.save({ title: 'Save' } as any)).toBeNull()
  })

  it('save() with no options returns null', async () => {
    const svc = new DefaultDialogService()
    expect(await svc.save()).toBeNull()
  })
})
