import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModelScopeTokenDialog } from '../ModelScopeTokenDialog'

describe('ModelScopeTokenDialog', () => {
  it('renders configured state and requires confirmation before clearing', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()

    render(
      <ModelScopeTokenDialog
        open
        onOpenChange={vi.fn()}
        token="ms-token-12345678"
        onSave={vi.fn()}
        onClear={onClear}
        inputId="modelscope-token-test"
        description="配置 Token 后可以查看需要鉴权的模型详情。"
        emptyStateMessage="当前未配置 Token。"
      />
    )

    expect(screen.getByText('当前状态：已配置')).toBeInTheDocument()
    expect(screen.getByText('当前 Token 已保存（尾号 5678）。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清除 Token…' }))

    expect(
      screen.getByText('清除后将无法查看需要鉴权的 ModelScope 模型详情。')
    ).toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '确认清除' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('submits a trimmed token value', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ModelScopeTokenDialog
        open
        onOpenChange={vi.fn()}
        token={null}
        onSave={onSave}
        onClear={vi.fn()}
        inputId="modelscope-token-save"
        description="配置 Token 后可以查看需要鉴权的模型详情。"
        emptyStateMessage="当前未配置 Token。"
        saveLabelWhenEmpty="保存并查看"
      />
    )

    await user.type(
      screen.getByLabelText('输入 Token'),
      '  modelscope-token-value  '
    )
    await user.click(screen.getByRole('button', { name: '保存并查看' }))

    expect(onSave).toHaveBeenCalledWith('modelscope-token-value')
  })
})
