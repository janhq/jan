import { describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ reload: vi.fn(async () => undefined) }))
vi.mock('../host', () => ({ getExtensionHost: () => host }))

import { reloadInstalled } from '../installed-reload'

describe('reloadInstalled', () => {
  it('respawns the extension from the registry', async () => {
    await reloadInstalled('acme.hello')
    expect(host.reload).toHaveBeenCalledWith('acme.hello')
  })
})
