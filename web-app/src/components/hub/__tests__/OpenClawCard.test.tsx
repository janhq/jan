import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OpenClawCard } from '../OpenClawCard'

describe('OpenClawCard', () => {
  it('shows the unified lifecycle card with runtime summary details', () => {
    render(
      <OpenClawCard
        status="running"
        version="OpenClaw 2026.4.24"
        gatewayUrl="http://127.0.0.1:18789/"
        serviceStatus="running"
        rpcStatus="ready"
        configStatus="valid"
      />
    )

    expect(screen.getByText('OpenClaw 实例')).toBeInTheDocument()
    expect(screen.getByText('版本')).toBeInTheDocument()
    expect(screen.getByText('OpenClaw 2026.4.24')).toBeInTheDocument()
    expect(screen.getByText('Gateway')).toBeInTheDocument()
    expect(screen.getByText('http://127.0.0.1:18789/')).toBeInTheDocument()
    expect(screen.getByText('服务')).toBeInTheDocument()
    expect(screen.getByText('RPC')).toBeInTheDocument()
    expect(screen.getByText('配置')).toBeInTheDocument()
  })
})
