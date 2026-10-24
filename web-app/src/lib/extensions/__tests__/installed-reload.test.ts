import { describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ terminate: vi.fn(async () => undefined) }))
vi.mock('../host', () => ({ getExtensionHost: () => host }))

import { reloadInstalled } from '../installed-reload'

describe('reloadInstalled', () => {
  it('stops the running copy so a revoked grant cannot be used', async () => {
    await reloadInstalled('acme.hello')
    expect(host.terminate).toHaveBeenCalledWith('acme.hello')
  })
})
