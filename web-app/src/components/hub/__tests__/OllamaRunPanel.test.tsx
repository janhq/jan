import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OllamaRunPanel } from '../OllamaRunPanel'

vi.mock('@/components/ui/tooltip', async () => {
  const React = await import('react')

  return {
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: React.forwardRef(
      (
        {
          children,
          asChild,
          ...props
        }: {
          children: React.ReactNode
          asChild?: boolean
          [key: string]: unknown
        },
        ref: React.ForwardedRef<HTMLElement>
      ) => {
        if (asChild && children && typeof children === 'object' && 'type' in children) {
          return React.cloneElement(children as React.ReactElement, {
            ...props,
            ref,
          })
        }

        return (
          <button ref={ref as React.ForwardedRef<HTMLButtonElement>} {...props}>
            {children}
          </button>
        )
      }
    ),
    TooltipContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="tooltip-content">{children}</div>
    ),
  }
})

vi.mock('@/components/ui/collapsible', async () => {
  const React = await import('react')
  const OpenContext = React.createContext(false)
  const ToggleContext = React.createContext<((open: boolean) => void) | null>(null)

  return {
    Collapsible: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <OpenContext.Provider value={Boolean(open)}>
        <ToggleContext.Provider value={onOpenChange ?? null}>
          <div>{children}</div>
        </ToggleContext.Provider>
      </OpenContext.Provider>
    ),
    CollapsibleTrigger: ({
      children,
      asChild,
      ...props
    }: {
      children: React.ReactNode
      asChild?: boolean
    }) => {
      const isOpen = React.useContext(OpenContext)
      const onToggle = React.useContext(ToggleContext)
      const triggerProps = {
        ...props,
        onClick: () => onToggle?.(!isOpen),
      }

      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement, triggerProps)
      }
      return <button {...triggerProps}>{children}</button>
    },
    CollapsibleContent: ({
      children,
      ...props
    }: {
      children: React.ReactNode
    }) => {
      const isOpen = React.useContext(OpenContext)
      if (!isOpen) return null
      return <div {...props}>{children}</div>
    },
  }
})

vi.mock('@/containers/ModelCombobox', () => ({
  ModelCombobox: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <input
      aria-label="model"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

describe('OllamaRunPanel', () => {
  it('keeps parameters visible and launch disabled when model is empty', () => {
    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByLabelText('model')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入或选择模型...')).toBeInTheDocument()
    expect(screen.getByText('model')).toBeInTheDocument()
    expect(screen.getByLabelText('temperature')).toBeInTheDocument()
    expect(screen.getByText('请选择 model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '启动' })).toBeDisabled()
  })

  it('keeps launch disabled for models outside the available list', async () => {
    const user = userEvent.setup()

    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('model'), 'not-installed')

    expect(screen.getByText('请选择可用的 model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '启动' })).toBeDisabled()
  })

  it('allows expanding the advanced section with raw field names', async () => {
    const user = userEvent.setup()
    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('system')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '高级' }))
    expect(screen.getByLabelText('system')).toBeInTheDocument()
    expect(screen.getByLabelText('shift')).toBeInTheDocument()
  })

  it('shows a visible loading state during submission', async () => {
    const user = userEvent.setup()

    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting
        onSubmit={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('model'), 'qwen2.5:7b')

    expect(screen.getByRole('button', { name: '启动中...' })).toBeDisabled()
  })

  it('submits built payload with official field names and nullable booleans', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn()

    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting={false}
        onSubmit={handleSubmit}
      />
    )

    await user.type(screen.getByLabelText('model'), 'qwen2.5:7b')
    await user.clear(screen.getByLabelText('temperature'))
    await user.type(screen.getByLabelText('temperature'), '0.7')
    await user.click(screen.getByRole('button', { name: '高级' }))
    await user.selectOptions(screen.getByLabelText('shift'), 'false')
    await user.click(screen.getByRole('button', { name: '启动' }))

    expect(handleSubmit).toHaveBeenCalledTimes(1)
    expect(handleSubmit).toHaveBeenCalledWith({
      model: 'qwen2.5:7b',
      shift: false,
      options: {
        temperature: 0.7,
      },
    })
  })

  it('shows a Chinese validation error when JSON fields are invalid', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn()

    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting={false}
        onSubmit={handleSubmit}
      />
    )

    await user.type(screen.getByLabelText('model'), 'qwen2.5:7b')
    await user.click(screen.getByRole('button', { name: '高级' }))
    fireEvent.change(screen.getByLabelText('context'), {
      target: { value: '{"foo":' },
    })
    await user.click(screen.getByRole('button', { name: '启动' }))

    expect(handleSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('context 需要有效的 JSON')).toBeInTheDocument()
  })

  it('renders console-style grouped fields with inline help affordances', async () => {
    const user = userEvent.setup()

    render(
      <OllamaRunPanel
        models={['qwen2.5:7b']}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByText('运行面板')).toBeInTheDocument()
    expect(screen.getByText('从本地已下载模型中选择后，直接配置本次启动参数并运行')).toBeInTheDocument()
    expect(screen.getByText('本次启动临时生效')).toBeInTheDocument()
    expect(screen.getByTestId('ollama-run-common-grid')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/查看 .* 参数说明/).length).toBeGreaterThan(3)
    expect(screen.getAllByTestId('tooltip-content').length).toBeGreaterThan(3)

    await user.click(screen.getByRole('button', { name: '高级' }))

    expect(screen.getByTestId('ollama-run-advanced-grid')).toBeInTheDocument()
  })
})
