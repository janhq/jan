import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenClawConfigDialog } from '../OpenClawConfigDialog'

describe('OpenClawConfigDialog', () => {
  it('allows launching with the existing OpenClaw configuration when no local model is selected', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <OpenClawConfigDialog
        open
        onOpenChange={vi.fn()}
        availableModels={[]}
        onConfirm={onConfirm}
      />
    )

    const launchButton = screen.getByRole('button', { name: '确认启动' })
    expect(launchButton).toBeEnabled()

    await user.click(launchButton)

    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('requires a local model only after enabling local Ollama injection', async () => {
    const user = userEvent.setup()

    render(
      <OpenClawConfigDialog
        open
        onOpenChange={vi.fn()}
        availableModels={[]}
        onConfirm={vi.fn()}
      />
    )

    await user.click(screen.getByRole('switch', { name: 'Inject local Ollama model' }))

    expect(screen.getByRole('button', { name: '确认启动' })).toBeDisabled()
    expect(screen.getByTestId('openclaw-local-model-empty')).toBeInTheDocument()
  })

  it('shows save-and-restart and dashboard handoff in manage mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onOpenDashboard = vi.fn()

    render(
      <OpenClawConfigDialog
        open
        onOpenChange={vi.fn()}
        availableModels={['qwen2.5:7b']}
        defaultModel="qwen2.5:7b"
        onConfirm={vi.fn()}
        onSave={onSave}
        onSaveAndRestart={onSave}
        onOpenDashboard={onOpenDashboard}
        mode="manage"
        isLoading={false}
      />
    )

    expect(screen.getByText('常用配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存并重启' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开 OpenClaw 控制台' }))
    expect(onOpenDashboard).toHaveBeenCalledTimes(1)
  })
})
