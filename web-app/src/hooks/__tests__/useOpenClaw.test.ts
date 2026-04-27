import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInvoke,
  mockListen,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
  mockOpenExternalUrl,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockOpenExternalUrl: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    info: mockToastInfo,
    success: mockToastSuccess,
  },
}))

vi.mock('@/lib/service', () => ({
  openExternalUrl: mockOpenExternalUrl,
}))

import { useOpenClaw } from '../useOpenClaw'

describe('useOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListen.mockResolvedValue(() => {})
  })

  it('maps a missing gateway service to installed instead of running', async () => {
    mockInvoke.mockResolvedValue({
      installed: true,
      version: 'OpenClaw 2026.4.24',
      gateway_port: 18789,
      gateway_url: undefined,
      service_loaded: false,
      service_runtime_status: 'stopped',
      service_runtime_detail: 'Gateway service missing.',
      rpc_ok: false,
      rpc_error: 'connect ECONNREFUSED 127.0.0.1:18789',
      port_status: 'free',
      cli_config_exists: false,
      daemon_config_exists: false,
      config_valid: true,
      health: 'stopped',
      message: 'Gateway service missing.',
    })

    const { result, unmount } = renderHook(() => useOpenClaw(60_000))

    await waitFor(() => {
      expect(result.current.status).toBe('installed')
    })

    expect(result.current.version).toBe('OpenClaw 2026.4.24')
    expect(result.current.gatewayUrl).toBeUndefined()
    expect(result.current.diagnostics.serviceLoaded).toBe(false)
    expect(result.current.diagnostics.rpcOk).toBe(false)
    unmount()
  })

  it('maps a running service with failed rpc probe to degraded', async () => {
    mockInvoke.mockResolvedValue({
      installed: true,
      version: 'OpenClaw 2026.4.24',
      gateway_port: 18789,
      gateway_url: 'http://127.0.0.1:18789/',
      service_loaded: true,
      service_runtime_status: 'running',
      service_runtime_detail: 'Task is currently running.',
      rpc_ok: false,
      rpc_error: 'handshake timeout',
      port_status: 'in-use',
      cli_config_exists: true,
      daemon_config_exists: true,
      config_valid: true,
      health: 'degraded',
      message: 'Gateway listener is up, but rpc is not ready yet.',
    })

    const { result, unmount } = renderHook(() => useOpenClaw(60_000))

    await waitFor(() => {
      expect(result.current.status).toBe('degraded')
    })

    expect(result.current.gatewayUrl).toBe('http://127.0.0.1:18789/')
    expect(result.current.errorMessage).toBe('Gateway listener is up, but rpc is not ready yet.')
    expect(result.current.diagnostics.serviceRuntimeStatus).toBe('running')
    expect(result.current.diagnostics.rpcError).toBe('handshake timeout')
    unmount()
  })
})
