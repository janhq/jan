import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@janhq/core', () => ({
  CoreRoutes: ['startServer'],
  APIRoutes: [],
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke }),
  }),
}))

vi.mock('@/lib/platform', () => ({
  isPlatformTauri: () => true,
}))

import { APIs } from '@/lib/service'

describe('startServer compatibility shim', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('forwards the CORS toggle to the backend config', () => {
    const startServer = (APIs as Record<string, (args?: unknown) => unknown>)
      .startServer

    startServer({
      host: '127.0.0.1',
      port: 1337,
      prefix: '/v1',
      apiKey: '',
      trustedHosts: ['localhost'],
      proxyTimeout: 600,
      isCorsEnabled: false,
    })

    expect(invoke).toHaveBeenCalledWith('start_server', {
      config: expect.objectContaining({ cors_enabled: false }),
    })
  })
})
