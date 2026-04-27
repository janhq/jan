import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenClawStatusBar } from '../OpenClawStatusBar'

describe('OpenClawStatusBar', () => {
  it('shows running state, gateway address, and restart action', async () => {
    const user = userEvent.setup()
    const onRestart = vi.fn()

    render(
      <OpenClawStatusBar
        status="running"
        version="0.2.0"
        gatewayUrl="http://127.0.0.1:18789/"
        isLoading={false}
        onInstall={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={onRestart}
        onEditConfig={vi.fn()}
        onOpenDashboard={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    expect(screen.getByText('OpenClaw 实例')).toBeInTheDocument()
    expect(screen.getByText('运行中')).toBeInTheDocument()
    expect(screen.getByText('http://127.0.0.1:18789/')).toBeInTheDocument()
    expect(screen.queryByText('版本 0.2.0')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重启' }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })
})
