import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenClawConfigSummary } from '../OpenClawConfigSummary'

describe('OpenClawConfigSummary', () => {
  it('renders launch mode, selected model, and dashboard action', async () => {
    const user = userEvent.setup()
    const onOpenDashboard = vi.fn()

    render(
      <OpenClawConfigSummary
        launchMode="local-ollama-injected"
        selectedModel="qwen2.5:7b"
        gatewayPort={18789}
        onOpenDashboard={onOpenDashboard}
      />
    )

    expect(screen.getByText('配置摘要')).toBeInTheDocument()
    expect(screen.getByText('注入本地 Ollama 模型')).toBeInTheDocument()
    expect(screen.getByText('qwen2.5:7b')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑配置' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开 OpenClaw 控制台' }))
    expect(onOpenDashboard).toHaveBeenCalledTimes(1)
  })
})
